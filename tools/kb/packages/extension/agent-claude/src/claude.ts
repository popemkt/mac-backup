import { Effect, Stream } from "effect";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentRuntimeError,
  MAX_STEPS,
  resolveCredential,
  userTurnText,
  type AgentAdapter,
  type AgentOutput,
  type AgentRuntime,
  type AgentTurn,
} from "@kb/agent";
import { KB_TOOL_SERVER, kbToolServer } from "./tool-server.ts";

/**
 * The `claude-agent-sdk` adapter: the agent runtime over Claude Code, through
 * the Claude Agent SDK (`DESIGN.md` → Agent packages). With nothing written
 * on its provider it runs the person's local Claude under the login they
 * already have, and kb reads no key. A provider may name a model, a `claude`
 * binary, an endpoint (`ANTHROPIC_BASE_URL`, such as a local proxy) and a
 * credential, a secret reference resolved when a turn starts and handed to
 * Claude Code as `ANTHROPIC_API_KEY`. The model's only tools are kb's
 * actions, served from an in-process MCP server built for each turn; Claude
 * Code's own tools, settings, MCP servers and CLAUDE.md files are all left
 * out.
 */

/**
 * How long one tool call may take. An approval-required call waits for the
 * person, who may take their time, so this is long; cancelling the turn
 * ends the wait at once.
 */
const CALL_TIMEOUT_MS = 30 * 60_000;

interface ClaudeRuntimeOptions {
  /**
   * Where Claude Code runs: the kb root. It also keeps its session files for
   * this directory there, in its own store, which is how a turn resumes.
   */
  readonly cwd: string;
  /** The model; absent is the default of the person's login. */
  readonly model?: string;
  /**
   * The `claude` executable. Absent is the one on PATH, the person's own
   * Claude Code; failing that, the SDK's bundled binary, which only a
   * checkout's `node_modules` has.
   */
  readonly executable?: string;
  /** Where Claude Code sends its requests (`ANTHROPIC_BASE_URL`); absent is its own default. */
  readonly endpoint?: string;
  /**
   * The key Claude Code sends (`ANTHROPIC_API_KEY`), read when a turn starts;
   * absent, or resolving to nothing, is the person's own login.
   */
  readonly key?: Effect.Effect<string | undefined, AgentRuntimeError>;
  /**
   * How a turn reaches Claude Code: the SDK's `query`, loaded when the first
   * turn runs. The runtime contract hands it a fake that plays a model over
   * the same messages, so everything else here runs as it does for real.
   */
  readonly query?: ClaudeQuery;
}

/** The part of the SDK's `query` a turn uses: start a session, read its messages. */
export type ClaudeQuery = (params: {
  readonly prompt: string;
  readonly options: Options;
}) => AsyncIterable<SDKMessage>;

/** The SDK's own `query`, imported on first use so no other command pays for it. */
const sdkQuery = Effect.tryPromise({
  try: () => import("@anthropic-ai/claude-agent-sdk"),
  catch: (error) =>
    new AgentRuntimeError({
      message: `the Claude Agent SDK did not load: ${messageOf(error)}`,
    }),
}).pipe(Effect.map((sdk): ClaudeQuery => sdk.query));

/** What one SDK message says to the bridge; most say nothing. */
function outputsOf(message: SDKMessage, wrote: { text: boolean }): readonly AgentOutput[] {
  if (message.type === "system" && message.subtype === "init") {
    return [{ kind: "session", resume: message.session_id }];
  }
  if (message.type !== "stream_event" || message.parent_tool_use_id !== null) return [];
  const { event } = message;
  // A new text block after earlier text is a new paragraph of the reply.
  if (event.type === "content_block_start" && event.content_block.type === "text" && wrote.text) {
    return [{ kind: "text", delta: "\n\n" }];
  }
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    wrote.text = true;
    return [{ kind: "text", delta: event.delta.text }];
  }
  return [];
}

/** The failure a result reports, if it reports one. */
function failureOf(message: SDKMessage): AgentRuntimeError | null {
  if (message.type !== "result") return null;
  if (message.subtype === "success") {
    return message.is_error ? new AgentRuntimeError({ message: message.result }) : null;
  }
  const reason = message.errors.join("; ") || message.subtype;
  return new AgentRuntimeError({ message: reason });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `messages`, aborting the turn before the session is told to stop when the
 * stream ends early. Closing the stream asks the iterator to `return`, which
 * may wait on the step in flight, and that step may be a tool call waiting
 * for the person; aborting first interrupts the call, so the turn ends at
 * once, as the port promises.
 */
function abortingFirst<A>(messages: AsyncIterable<A>, abort: AbortController): AsyncIterable<A> {
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = messages[Symbol.asyncIterator]();
      return {
        next: () => iterator.next(),
        return: (value?: unknown) => {
          abort.abort();
          return iterator.return?.(value) ?? Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

/** The `claude` this machine runs, unless the caller named one. */
function executableFor(options: ClaudeRuntimeOptions): string | undefined {
  return options.executable ?? Bun.which("claude") ?? undefined;
}

/**
 * The environment Claude Code runs in: this process's, unless the provider
 * names an endpoint or a key. The SDK replaces the environment it is given
 * rather than merging it, so those two are laid over this process's.
 */
function environmentFor(
  endpoint: string | undefined,
  key: string | undefined,
): Pick<Options, "env"> {
  if (endpoint === undefined && key === undefined) return {};
  return {
    env: {
      // oxlint-disable-next-line node/no-process-env -- Claude Code inherits this process's environment, as it would unconfigured
      ...process.env,
      ...(endpoint === undefined ? {} : { ANTHROPIC_BASE_URL: endpoint }),
      ...(key === undefined ? {} : { ANTHROPIC_API_KEY: key }),
    },
  };
}

function queryOptions(
  options: ClaudeRuntimeOptions,
  turn: AgentTurn,
  abort: AbortController,
  key: string | undefined,
): Options {
  const executable = executableFor(options);
  return {
    cwd: options.cwd,
    ...environmentFor(options.endpoint, key),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
    systemPrompt: turn.system,
    // Nothing of Claude Code's own: no built-in tools, no settings, no
    // CLAUDE.md, no MCP servers but kb's.
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {
      [KB_TOOL_SERVER]: {
        type: "sdk",
        name: KB_TOOL_SERVER,
        instance: kbToolServer(turn, abort.signal),
        timeout: CALL_TIMEOUT_MS,
      },
    },
    // kb's tools run without Claude Code asking; whether a person must
    // approve a call is kb's to decide, by the action's mode.
    allowedTools: [`mcp__${KB_TOOL_SERVER}__*`],
    permissionMode: "dontAsk",
    includePartialMessages: true,
    maxTurns: MAX_STEPS,
    abortController: abort,
    ...(turn.resume === undefined ? {} : { resume: turn.resume }),
  };
}

function claudeRuntime(options: ClaudeRuntimeOptions): AgentRuntime {
  return {
    name: "Claude",
    turn: (turn) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const query = options.query ?? (yield* sdkQuery);
          const key = options.key === undefined ? undefined : yield* options.key;
          // Aborted when the stream ends for any reason, a cancel included:
          // Claude Code stops, and so does any call still running.
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          );
          const messages = abortingFirst(
            query({
              prompt: userTurnText(turn.message),
              options: queryOptions(options, turn, abort, key),
            }),
            abort,
          );
          const wrote = { text: false };
          return Stream.fromAsyncIterable(
            messages,
            (error) => new AgentRuntimeError({ message: messageOf(error) }),
          ).pipe(
            Stream.mapEffect((message) => {
              const failure = failureOf(message);
              return failure === null ? Effect.succeed(outputsOf(message, wrote)) : failure;
            }),
            Stream.flatMap((outputs) => Stream.fromIterable(outputs)),
          );
        }),
      ),
  };
}

/**
 * The `claude-agent-sdk` adapter, running Claude Code in `cwd` (the kb root)
 * with what each provider writes; `query` is the SDK's unless a test hands
 * it a fake.
 */
export function claudeAdapter(options: {
  readonly cwd: string;
  readonly query?: ClaudeQuery;
}): AgentAdapter {
  return {
    id: "claude-agent-sdk",
    runtime: (provider, secrets) =>
      claudeRuntime({
        cwd: options.cwd,
        ...(options.query === undefined ? {} : { query: options.query }),
        ...(provider.model === null ? {} : { model: provider.model }),
        ...(provider.executable === null ? {} : { executable: provider.executable }),
        ...(provider.endpoint === null ? {} : { endpoint: provider.endpoint }),
        key: resolveCredential(provider.credential, secrets),
      }),
  };
}
