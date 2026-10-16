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
 * bearer token, read when each step starts.
 */

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
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
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
    return yield* new AgentRuntimeError({
      message: `the endpoint sent a chunk kb cannot read: ${data.slice(0, 200)}`,
    });
  }
  if (decoded.success.error !== undefined) {
    return yield* new AgentRuntimeError({ message: decoded.success.error.message });
  }
  return decoded.success;
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The step over `provider`, or one that fails saying what the provider lacks. */
function chatStep(provider: ProviderConfig, secrets: SecretSource, send: ChatFetch): Step {
  const { endpoint, model } = provider;
  if (endpoint === null || model === null) {
    const missing = endpoint === null ? "an endpoint" : "a model";
    return () =>
      Stream.fail(
        new AgentRuntimeError({
          message: `An OpenAI-compatible provider needs ${missing}; write it on the provider's node.`,
        }),
      );
  }
  const url = `${endpoint.replace(/\/+$/, "")}/chat/completions`;
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
            new AgentRuntimeError({ message: `${url} did not answer: ${messageOf(error)}` }),
        });
        if (!response.ok) {
          const said = yield* Effect.promise(() => response.text().catch(() => ""));
          return yield* new AgentRuntimeError({
            message: `${url} answered ${response.status}: ${said.slice(0, 500)}`,
          });
        }
        const stream = response.body;
        if (stream === null) {
          return yield* new AgentRuntimeError({ message: `${url} answered with no body` });
        }
        return Stream.fromReadableStream({
          evaluate: () => stream,
          onError: (error) => new AgentRuntimeError({ message: `${url}: ${messageOf(error)}` }),
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
 * a fake that serves a model.
 */
export function openAiChatAdapter(options: { readonly fetch?: ChatFetch } = {}): AgentAdapter {
  const send: ChatFetch =
    options.fetch ?? ((url, init) => fetch(url, { ...init, headers: { ...init.headers } }));
  return {
    id: "openai-chat",
    runtime: (provider, secrets) =>
      stepRuntime({ name: "OpenAI-compatible chat", step: chatStep(provider, secrets, send) }),
  };
}
