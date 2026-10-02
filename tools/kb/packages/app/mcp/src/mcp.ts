import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Cause, Effect, Exit } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  asObjectSchema,
  failed,
  listedOn,
  mcpToolHints,
  mcpToolName,
  mcpToolResult,
  type ActionInvocation,
  type KbContext,
  type ManifestEntry,
  type SurfaceWire,
} from "@kb/contracts";
import { type DomainError, domainError, ensureDomainError } from "@kb/model";
import { reloadEffect, listViewNamesEffect, renderViewNodeEffect } from "@kb/operations";
import {
  invokeReceiptEffect,
  kbRuntimeLayer,
  openKbEffect,
  registryFor,
  resolveRootEffect,
  type RootNotFoundError,
  writeErr,
  bunFileSystemLayer,
} from "@kb/runtime";

const VIEW_URI_PREFIX = "ui://kb/view/";

/** The resource a docs view is read as: its name, URI-encoded, under the prefix. */
function viewUri(name: string): string {
  return `${VIEW_URI_PREFIX}${encodeURIComponent(name)}`;
}

/** The docs view name a resource URI addresses, or null when it addresses none. */
function viewNameOfUri(uri: string): string | null {
  if (!uri.startsWith(VIEW_URI_PREFIX)) return null;
  try {
    return decodeURIComponent(uri.slice(VIEW_URI_PREFIX.length));
  } catch {
    return null;
  }
}

/**
 * The `_meta` key under which every tool carries the action it projects:
 * `{id, mode}`, exactly as the manifest has them. A tool name is the id with
 * `.` mangled to `_`, so it cannot be mapped back, and the hints cannot say
 * "requires approval". This key lets an MCP client see both anyway.
 */
export const ACTION_META_KEY = "kb/action";

/**
 * MCP's wire: a `tools/call` has no envelope, because its arguments are the
 * input, so it cannot carry `approved`. `tools/list` therefore leaves
 * approval-required actions out ({@link listedOn}); a call by tool name still
 * reaches the invoke core and gets `approval_required`, and `kb.manifest`
 * still lists them.
 */
export const MCP_WIRE: SurfaceWire = {
  // GAP [[01M3R2KD6V1AZ9WS62ZVG9T4G2]]
  carriesApproval: false,
};

function causeMessage(cause: Cause.Cause<unknown>): string {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error ? squashed.message : String(squashed);
}

/**
 * Map typed Failures and Die defects to an `isError` tool result.
 *
 * External Fiber interruption is not claimed as recovered here: interrupting
 * the `Effect.runPromise` host fiber can still reject at the Promise edge.
 * Pure interrupt-only causes are re-raised so we do not pretend MCP can
 * turn cancellation into a normal tool result.
 */
export function containToolResult<E, R>(
  effect: Effect.Effect<CallToolResult, E, R>,
): Effect.Effect<CallToolResult, never, R> {
  return Effect.exit(effect).pipe(
    Effect.flatMap((exit): Effect.Effect<CallToolResult> => {
      if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
      // Cancellation is not a tool failure: re-interrupt rather than
      // reporting `isError`, and the CallTool edge rejects as before.
      if (Cause.hasInterruptsOnly(exit.cause)) return Effect.interrupt;
      return Effect.succeed(mcpToolResult(failed("unknown", "internal", causeMessage(exit.cause))));
    }),
  );
}

/** Canonical JSON-RPC -32603 for resource-handler Failures and Die defects. */
export function mcpInternalError(cause: Cause.Cause<unknown>): McpError {
  return new McpError(ErrorCode.InternalError, causeMessage(cause));
}

/** Every tool this server lists is a registry action, found by its tool name. */
export interface McpToolContext {
  byToolName: ReadonlyMap<string, ManifestEntry>;
}

/**
 * Effect program for one MCP CallTool request. Failures and Die defects are
 * mapped to {@link CallToolResult} with `isError`. Interrupt-only cancellation
 * is not converted into a tool result (see {@link containToolResult}).
 */
export function callToolEffect(
  ctx: KbContext,
  name: string,
  args: unknown,
  tools: McpToolContext,
): Effect.Effect<CallToolResult> {
  return containToolResult(
    Effect.gen(function* () {
      const action = tools.byToolName.get(name);
      if (!action) {
        return mcpToolResult(failed(name, "unknown_action", `unknown tool: ${name}`));
      }

      const invocation: ActionInvocation = {
        id: action.id,
        input: args ?? {},
      };
      // Long-lived server vs CLI mutators: reload keeps per-invocation freshness.
      yield* reloadEffect(ctx);
      return mcpToolResult(yield* invokeReceiptEffect(ctx, invocation));
    }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
  );
}

const listResourcesEffect = Effect.fn("mcp.listResources")(function* (ctx: KbContext) {
  yield* reloadEffect(ctx);
  const names = yield* listViewNamesEffect();
  return {
    resources: names.map((name) => ({
      uri: viewUri(name),
      name: `kb view: ${name}`,
      mimeType: "text/html",
    })),
  };
});

const readResourceEffect = Effect.fn("mcp.readResource")(function* (ctx: KbContext, uri: string) {
  const name = viewNameOfUri(uri);
  if (name === null) return yield* domainError("not_found", `unknown resource: ${uri}`);
  yield* reloadEffect(ctx);
  const rendered = yield* renderViewNodeEffect({ name }, "html");
  return {
    contents: [{ uri, mimeType: "text/html", text: rendered.content }],
  };
});

/**
 * Run a resource Effect to an Exit, then throw {@link McpError} (-32603) on
 * Failure/Die so the Promise edge surfaces a canonical JSON-RPC internal
 * error. Interrupt-only causes propagate as FiberFailure rejects — they are
 * not rewritten into -32603.
 */
export function runResourceHandler<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    if (Cause.hasInterruptsOnly(exit.cause)) {
      return Effect.runPromise(Effect.failCause(exit.cause));
    }
    throw mcpInternalError(exit.cause);
  });
}

/**
 * Build an MCP server bound to a kb root. Does not connect a transport —
 * callers connect stdio (startMcp) or InMemoryTransport (tests).
 */
export const createMcpServer = Effect.fn("kb.createMcpServer")(function* (
  root: string,
  // oxlint-disable-next-line typescript/no-deprecated -- registry-built tool list; McpServer cannot express it (SDK docs)
): Effect.fn.Return<Server, DomainError, FileSystem> {
  const ctx = yield* openKbEffect(root);
  const actions = (yield* registryFor(root)).manifestEntries;
  const byToolName = new Map(actions.map((a) => [mcpToolName(a.id), a] as const));
  const tools = actions
    .filter((a) => listedOn(MCP_WIRE, a.mode))
    .map(
      (a): Tool => ({
        name: mcpToolName(a.id),
        title: a.title,
        description: a.description,
        inputSchema: asObjectSchema(a.inputSchema),
        annotations: { title: a.title, ...mcpToolHints(a.mode) },
        _meta: { [ACTION_META_KEY]: { id: a.id, mode: a.mode } },
      }),
    );

  return bindMcpHandlers(ctx, tools, { byToolName });
}, Effect.provide(bunFileSystemLayer));

/**
 * The MCP SDK boundary. Every request handler must hand the SDK a promise, so
 * this is where kb's Effects are run — a plain function beside the builder,
 * not inside it.
 */
function bindMcpHandlers(ctx: KbContext, tools: Tool[], toolsCtx: McpToolContext) {
  // oxlint-disable-next-line typescript/no-deprecated -- registry-built tool list; McpServer cannot express it (SDK docs)
  const server = new Server(
    { name: "kb", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  // MCP Apps backbone: each saved view is a ui:// html resource.
  server.setRequestHandler(ListResourcesRequestSchema, () =>
    runResourceHandler(listResourcesEffect(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx)))),
  );

  server.setRequestHandler(ReadResourceRequestSchema, (request) =>
    runResourceHandler(
      readResourceEffect(ctx, request.params.uri).pipe(Effect.provide(kbRuntimeLayer(ctx))),
    ),
  );

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name, arguments: args } = request.params;
    // callToolEffect provides kbRuntimeLayer and maps Fail/Die → isError.
    return Effect.runPromise(callToolEffect(ctx, name, args, toolsCtx));
  });

  return server;
}

/**
 * Start the kb MCP server on stdio for the given data root.
 * Safe for CLI `kb mcp` to call without importing commander.
 */
export const startMcp = Effect.fn("kb.startMcp")(function* (
  root: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const server = yield* createMcpServer(root);
  const transport = new StdioServerTransport();
  yield* Effect.tryPromise({
    try: () => server.connect(transport),
    catch: ensureDomainError,
  });
});

const parseRoot = Effect.fn("kb.mcp.parseRoot")(function* (
  argv: string[],
): Effect.fn.Return<string, DomainError | RootNotFoundError, FileSystem> {
  const idx = argv.indexOf("--root");
  if (idx >= 0) {
    const value = argv[idx + 1];
    if (value === undefined || value === "" || value.startsWith("-")) {
      return yield* domainError("invalid_input", "missing value for --root");
    }
    return value;
  }
  // MCP clients launch with cwd = project dir; walk upward to find .kb/.
  return yield* resolveRootEffect();
});

if (import.meta.main) {
  await Effect.runPromise(
    Effect.gen(function* () {
      const root = yield* parseRoot(process.argv.slice(2));
      yield* startMcp(root);
    }).pipe(
      Effect.provide(bunFileSystemLayer),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const err: unknown = Cause.squash(cause);
          writeErr(`kb mcp: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }),
      ),
    ),
  );
}
