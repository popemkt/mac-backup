import { Effect, Stream } from "effect";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentRuntimeError,
  userTurnText,
  type AgentOutput,
  type AgentRuntime,
  type AgentTurn,
} from "@kb/agent";
import { KB_TOOL_SERVER, kbToolServer } from "./tool-server.ts";

/**
 * The agent runtime over the person's local Claude, through the Claude Agent
 * SDK (`DESIGN.md` → Agent packages). It runs Claude Code under the login
 * the person already has: kb configures no API key and reads none. The
 * model's only tools are kb's actions, served from an in-process MCP server
 * built for each turn; Claude Code's own tools, settings, MCP servers and
 * CLAUDE.md files are all left out.
 */

/**
 * How long one tool call may take. An approval-required call waits for the
 * person, who may take their time, so this is long; cancelling the turn
 * ends the wait at once.
 */
const CALL_TIMEOUT_MS = 30 * 60_000;

/** At most this many model steps per message, so a confused loop ends. */
const MAX_STEPS = 40;

export interface ClaudeRuntimeOptions {
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
}

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

/** The `claude` this machine runs, unless the caller named one. */
function executableFor(options: ClaudeRuntimeOptions): string | undefined {
  return options.executable ?? Bun.which("claude") ?? undefined;
}

function queryOptions(
  options: ClaudeRuntimeOptions,
  turn: AgentTurn,
  abort: AbortController,
): Options {
  const executable = executableFor(options);
  return {
    cwd: options.cwd,
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

export function claudeRuntime(options: ClaudeRuntimeOptions): AgentRuntime {
  return {
    name: "Claude",
    turn: (turn) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sdk = yield* Effect.tryPromise({
            try: () => import("@anthropic-ai/claude-agent-sdk"),
            catch: (error) =>
              new AgentRuntimeError({
                message: `the Claude Agent SDK did not load: ${messageOf(error)}`,
              }),
          });
          // Aborted when the stream ends for any reason, a cancel included:
          // Claude Code stops, and so does any call still running.
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          );
          const messages = sdk.query({
            prompt: userTurnText(turn.message),
            options: queryOptions(options, turn, abort),
          });
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
