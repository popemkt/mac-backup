import { realpathSync } from "node:fs";
import { sep } from "node:path";
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
 * Claude Code as `ANTHROPIC_API_KEY`. Claude Code runs with an explicit
 * environment (`environmentFor`), never this process's whole one. The
 * model's only tools are kb's
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
  /** This process's environment, which Claude Code's is chosen from. */
  readonly inherited: Environment;
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

/** `path`'s real path, or `path` when it has none. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The `claude` a turn runs: the provider's, which a person trusted with its
 * binding, or the one the person's own `PATH` finds (the one the runtime
 * is started with, of this process's environment). `PATH` is theirs, as
 * their shell's is, but a `claude` it finds inside the root is the root's,
 * and a root someone else wrote may carry one, so that one never runs.
 */
const executableFor = Effect.fn("kb.agent.claude.executable")(function* (
  options: ClaudeRuntimeOptions,
): Effect.fn.Return<string | undefined, AgentRuntimeError> {
  if (options.executable !== undefined) return options.executable;
  const found = Bun.which("claude", { PATH: options.inherited.PATH ?? "" });
  if (found === null) return undefined;
  if (!real(found).startsWith(`${real(options.cwd)}${sep}`)) return found;
  return yield* new AgentRuntimeError({
    message: `The claude on PATH is inside this root (${found}); name the executable on a provider instead.`,
  });
});

/** A process environment, as `process.env` reads. */
type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The person's own Claude login and endpoint, as they set them for Claude
 * Code. They pass only to a Claude Code whose provider names neither an
 * endpoint nor a key, which is that same login.
 */
const CLAUDE_LOGIN_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
] as const;

/**
 * What Claude Code reads of the environment it is started in: where it
 * keeps its state, the network it reaches through, and the person's login.
 * kb's child environment keeps these of its own process for the agent
 * runtime, and nothing else of its own beyond what any program needs.
 */
export const CLAUDE_VARIABLES = [
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  ...CLAUDE_LOGIN_VARIABLES,
] as const;

/** `inherited`'s set variables, without `names`. */
function without(inherited: Environment, names: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (value !== undefined && !names.includes(name)) env[name] = value;
  }
  return env;
}

/**
 * The environment Claude Code runs in, explicit (the SDK replaces the
 * environment it is given rather than merging it): the one kb gives an
 * agent runtime (`inherited`, chosen by kb's child-environment owner), and
 * of it the person's own login only with a provider that names neither an
 * endpoint nor a key. With one that names either, it is exactly what the
 * provider names and none of the person's login, so a key goes only to the
 * endpoint the provider names, or to Claude's own default.
 */
function environmentFor(
  inherited: Environment,
  endpoint: string | undefined,
  key: string | undefined,
): Record<string, string> {
  const own = endpoint === undefined && key === undefined;
  return {
    ...without(inherited, own ? [] : CLAUDE_LOGIN_VARIABLES),
    ...(endpoint === undefined ? {} : { ANTHROPIC_BASE_URL: endpoint }),
    ...(key === undefined ? {} : { ANTHROPIC_API_KEY: key }),
  };
}

function queryOptions(
  options: ClaudeRuntimeOptions,
  turn: AgentTurn,
  abort: AbortController,
  key: string | undefined,
  executable: string | undefined,
): Options {
  return {
    cwd: options.cwd,
    env: environmentFor(options.inherited, options.endpoint, key),
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
          const executable = yield* executableFor(options);
          // Aborted when the stream ends for any reason, a cancel included:
          // Claude Code stops, and so does any call still running.
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          );
          const messages = abortingFirst(
            query({
              prompt: userTurnText(turn.message),
              options: queryOptions(options, turn, abort, key, executable),
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
  /** The environment kb gives an agent runtime, which Claude Code's is chosen from. */
  readonly env: Environment;
}): AgentAdapter {
  const inherited = options.env;
  return {
    id: "claude-agent-sdk",
    runtime: (provider, secrets) =>
      claudeRuntime({
        cwd: options.cwd,
        inherited,
        ...(options.query === undefined ? {} : { query: options.query }),
        ...(provider.model === null ? {} : { model: provider.model }),
        ...(provider.executable === null ? {} : { executable: provider.executable }),
        ...(provider.endpoint === null ? {} : { endpoint: provider.endpoint }),
        key: resolveCredential(provider.credential, secrets),
      }),
  };
}
