import { Effect, Result, Schema, Stream } from "effect";
import {
  AgentRuntimeError,
  resolveCredential,
  stepRuntime,
  type AgentAdapter,
  type ProviderConfig,
  type Step,
  type StepCall,
  type StepEvent,
  type StepMessage,
  type StepTool,
} from "@kb/agent";
import type { SecretSource } from "@kb/contracts";

/**
 * The `openai-chat` adapter (`DESIGN.md` → Agent packages): any endpoint that
 * speaks OpenAI's Chat Completions, such as a local CLIProxyAPI or Ollama's
 * `/v1`. The wire runs one model step per request, so the tool loop is the
 * step loop's (`stepRuntime`); this file is only the step: the conversation
 * and the tools as Chat Completions takes them, one streamed POST, and its
 * server-sent events read back as text and calls.
 *
 * A provider names the endpoint (the base, ending `/v1` as such servers
 * publish it) and the model; a credential, when it names one, is sent as a
 * bearer token, read when each step starts. The endpoint is `https`, or
 * plain `http` only on this machine (loopback), so neither the key nor the
 * conversation crosses a network in the clear. A failure names the
 * endpoint's origin, its status and a short error code, never what the
 * server sent back, and a server that does not answer within
 * {@link ANSWER_TIMEOUT_MS} ends the step.
 */

/** How long a step waits for the endpoint to start answering. */
const ANSWER_TIMEOUT_MS = 60_000;

/** What a step hands `fetch`: one POST, cancelled through `signal`. */
export interface ChatRequestInit {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

/** The part of `fetch` a step uses. The contract hands it a fake that serves a model. */
export type ChatFetch = (url: string, init: ChatRequestInit) => Promise<Response>;

/** A message as Chat Completions takes it. */
function wireMessage(message: StepMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.call, content: message.text };
  }
  if (message.role !== "assistant") return { role: message.role, content: message.text };
  return {
    role: "assistant",
    content: message.text === "" ? null : message.text,
    ...(message.calls.length === 0
      ? {}
      : {
          tool_calls: message.calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.input) },
          })),
        }),
  };
}

function wireTool(tool: StepTool): Record<string, unknown> {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

const Text = Schema.NullOr(Schema.String);

/** An error as OpenAI-compatible servers report one: its code or type is all kb repeats. */
const ErrorDetail = Schema.Struct({
  code: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const ErrorBody = Schema.Struct({ error: ErrorDetail });
const decodeErrorBody = Schema.decodeUnknownResult(Schema.fromJsonString(ErrorBody));

/** A short error code a server sent, if it sent one kb may repeat: a word, never prose. */
function codeOf(detail: typeof ErrorDetail.Type | undefined): string | null {
  const said = detail?.code ?? detail?.type;
  if (said === undefined || said === null) return null;
  const code = String(said);
  return /^[\w.-]{1,64}$/.test(code) ? code : null;
}

/** One streamed chunk: text and pieces of calls, by the call's index. */
const Chunk = Schema.Struct({
  choices: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        delta: Schema.optionalKey(
          Schema.Struct({
            content: Schema.optionalKey(Text),
            tool_calls: Schema.optionalKey(
              Schema.Array(
                Schema.Struct({
                  index: Schema.Finite,
                  id: Schema.optionalKey(Text),
                  function: Schema.optionalKey(
                    Schema.Struct({
                      name: Schema.optionalKey(Text),
                      arguments: Schema.optionalKey(Text),
                    }),
                  ),
                }),
              ),
            ),
          }),
        ),
      }),
    ),
  ),
  error: Schema.optionalKey(ErrorDetail),
});
type Chunk = typeof Chunk.Type;

const decodeChunk = Schema.decodeUnknownResult(Schema.fromJsonString(Chunk));
const decodeArguments = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

/** A call as its pieces arrive. */
interface Partial {
  id: string;
  name: string;
  arguments: string;
}

/**
 * A call's input: its arguments as JSON, or, when they are not JSON, the
 * text itself, which the action's input check then refuses in the receipt
 * the model is handed back.
 */
function inputOf(text: string): unknown {
  if (text.trim() === "") return {};
  const decoded = decodeArguments(text);
  return Result.isSuccess(decoded) ? decoded.success : text;
}

/** Fold one chunk into the calls so far; its text is emitted at once. */
function absorb(calls: Map<number, Partial>, chunk: Chunk): readonly StepEvent[] {
  const events: StepEvent[] = [];
  for (const choice of chunk.choices ?? []) {
    const delta = choice.delta;
    if (delta === undefined) continue;
    if (typeof delta.content === "string" && delta.content !== "") {
      events.push({ kind: "text", delta: delta.content });
    }
    for (const piece of delta.tool_calls ?? []) {
      const call = calls.get(piece.index) ?? { id: "", name: "", arguments: "" };
      call.id ||= piece.id ?? "";
      call.name += piece.function?.name ?? "";
      call.arguments += piece.function?.arguments ?? "";
      calls.set(piece.index, call);
    }
  }
  return events;
}

/** The calls a step asked for, in the order the model numbered them, once it has finished. */
function finished(calls: Map<number, Partial>): readonly StepEvent[] {
  return [...calls.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([index, call]): StepEvent => {
      const stepCall: StepCall = {
        id: call.id === "" ? `call-${index}` : call.id,
        name: call.name,
        input: inputOf(call.arguments),
      };
      return { kind: "call", call: stepCall };
    });
}

/** The chunk a server-sent `data:` line carries, or null for any other line and the end marker. */
const chunkOf = Effect.fnUntraced(function* (line: string) {
  if (!line.startsWith("data:")) return null;
  const data = line.slice("data:".length).trim();
  if (data === "" || data === "[DONE]") return null;
  const decoded = decodeChunk(data);
  if (Result.isFailure(decoded)) {
    return yield* new AgentRuntimeError({ message: "the endpoint sent a chunk kb cannot read" });
  }
  if (decoded.success.error !== undefined) {
    const code = codeOf(decoded.success.error);
    return yield* new AgentRuntimeError({
      message: `the endpoint reported an error${code === null ? "" : ` (${code})`}`,
    });
  }
  return decoded.success;
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "[::1]"]);

/** Whether `host` is this machine: `localhost`, `::1` or an address in 127.0.0.0/8. */
function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * The endpoint a provider names, as a URL kb will send to, or why not: it
 * must parse, carry no credentials of its own, and be `https`, or `http` on
 * this machine.
 */
function endpointUrl(endpoint: string): URL | string {
  const its = "An OpenAI-compatible provider's endpoint";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return `${its} is not a URL.`;
  }
  if (url.username !== "" || url.password !== "") {
    return `${its} carries credentials; name a credential instead.`;
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopback(url.hostname)) return url;
  return `${its} must be https, or http on this machine (localhost).`;
}

/** A step that only fails, saying what the provider lacks. */
function refusedStep(message: string): Step {
  return () => Stream.fail(new AgentRuntimeError({ message }));
}

const needs = (what: string) =>
  `An OpenAI-compatible provider needs ${what}; write it on the provider's node.`;

/** The step over `provider`, or one that fails saying what the provider lacks. */
function chatStep(
  provider: ProviderConfig,
  secrets: SecretSource,
  send: ChatFetch,
  answerTimeoutMs: number,
): Step {
  const { endpoint, model } = provider;
  if (endpoint === null) return refusedStep(needs("an endpoint"));
  if (model === null) return refusedStep(needs("a model"));
  const base = endpointUrl(endpoint);
  if (typeof base === "string") return refusedStep(base);
  const origin = base.origin;
  const url = `${base.href.replace(/\/+$/, "")}/chat/completions`;
  return (messages, tools) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const key = yield* resolveCredential(provider.credential, secrets);
        const body = JSON.stringify({
          model,
          stream: true,
          messages: messages.map(wireMessage),
          ...(tools.length === 0 ? {} : { tools: tools.map(wireTool) }),
        });
        const headers: Record<string, string> = {
          "content-type": "application/json",
          accept: "text/event-stream",
          ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
        };
        const response = yield* Effect.tryPromise({
          try: (signal) => send(url, { method: "POST", headers, body, signal }),
          catch: (error) =>
            new AgentRuntimeError({ message: `${origin} did not answer: ${messageOf(error)}` }),
        }).pipe(
          Effect.timeoutOrElse({
            duration: answerTimeoutMs,
            orElse: () =>
              Effect.fail(
                new AgentRuntimeError({
                  message: `${origin} did not answer within ${answerTimeoutMs / 1000}s`,
                }),
              ),
          }),
        );
        if (!response.ok) {
          const said = yield* Effect.promise(() => response.text().catch(() => ""));
          const decoded = decodeErrorBody(said);
          const code = Result.isSuccess(decoded) ? codeOf(decoded.success.error) : null;
          return yield* new AgentRuntimeError({
            message: `${origin} answered ${response.status}${code === null ? "" : ` (${code})`}`,
          });
        }
        const stream = response.body;
        if (stream === null) {
          return yield* new AgentRuntimeError({ message: `${origin} answered with no body` });
        }
        return Stream.fromReadableStream({
          evaluate: () => stream,
          onError: (error) => new AgentRuntimeError({ message: `${origin}: ${messageOf(error)}` }),
        }).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.mapEffect(chunkOf),
          Stream.mapAccum(
            () => new Map<number, Partial>(),
            (calls, chunk) => [calls, chunk === null ? [] : absorb(calls, chunk)] as const,
            { onHalt: finished },
          ),
        );
      }),
    );
}

/**
 * The `openai-chat` adapter. `fetch` is the platform's unless a test hands it
 * a fake that serves a model, and a step waits {@link ANSWER_TIMEOUT_MS} for
 * an answer unless a test says otherwise.
 */
export function openAiChatAdapter(
  options: { readonly fetch?: ChatFetch; readonly answerTimeoutMs?: number } = {},
): AgentAdapter {
  const send: ChatFetch =
    options.fetch ?? ((url, init) => fetch(url, { ...init, headers: { ...init.headers } }));
  const timeout = options.answerTimeoutMs ?? ANSWER_TIMEOUT_MS;
  return {
    id: "openai-chat",
    runtime: (provider, secrets) =>
      stepRuntime({
        name: "OpenAI-compatible chat",
        step: chatStep(provider, secrets, send, timeout),
      }),
  };
}
