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
import { Cause, Effect, Exit, Schema } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { KbContext, ActionInvocation } from "@kb/contracts";
import { type DomainError, domainError, ensureDomainError } from "@kb/model";
import { reloadEffect, listViewNamesEffect, renderNamedViewEffect } from "@kb/operations";
import {
  invokeReceiptEffect,
  kbRuntimeLayer,
  openKbEffect,
  registryFor,
  resolveRootEffect,
  type RootNotFoundError,
  writeErr,
  type ManifestEntry,
} from "@kb/runtime";
import { bunFileSystemLayer } from "@kb/store-jsonl";

const MANIFEST_TOOL = "kb_manifest";
const RENDER_TOOL = "render_view";
const VIEW_URI_PREFIX = "ui://kb/view/";

const RenderViewArgs = Schema.Struct({
  view: Schema.String,
  // null/absent → html (base MCP client behavior); optionalKey alone rejects null.
  format: Schema.optionalKey(Schema.NullOr(Schema.Literals(["html", "md"]))),
});

function actionIdToToolName(actionId: string): string {
  return actionId.replaceAll(".", "_");
}

function asObjectSchema(schema: unknown): Tool["inputSchema"] {
  if (
    typeof schema === "object" &&
    schema !== null &&
    (schema as { type?: unknown }).type === "object"
  ) {
    return schema as Tool["inputSchema"];
  }
  return { type: "object" as const, properties: {} };
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function errorResult(code: string, message: string, details?: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          code,
          message,
          ...(details === undefined ? {} : { details }),
        }),
      },
    ],
  };
}

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
    Effect.flatMap((exit) => {
      if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
      if (Cause.hasInterruptsOnly(exit.cause)) {
        // Re-raise interrupt; cast keeps the CallTool Promise edge typed as
        // never while still rejecting on cancellation.
        return Effect.failCause(exit.cause) as unknown as Effect.Effect<CallToolResult>;
      }
      return Effect.succeed(errorResult("internal", causeMessage(exit.cause)));
    }),
  );
}

/** Canonical JSON-RPC -32603 for resource-handler Failures and Die defects. */
export function mcpInternalError(cause: Cause.Cause<unknown>): McpError {
  return new McpError(ErrorCode.InternalError, causeMessage(cause));
}

export interface McpToolContext {
  actions: readonly ManifestEntry[];
  byToolName: Map<string, ManifestEntry>;
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
      if (name === MANIFEST_TOOL) {
        return jsonResult(tools.actions);
      }

      if (name === RENDER_TOOL) {
        const decoded = yield* Schema.decodeUnknownEffect(RenderViewArgs)(args ?? {}).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (!decoded) {
          return errorResult("invalid_input", "expected {view: string, format?: 'html'|'md'}");
        }
        const format = decoded.format ?? "html";
        yield* reloadEffect(ctx);
        const rendered = yield* renderNamedViewEffect(decoded.view, format);
        return {
          content: [{ type: "text" as const, text: rendered.content }],
        } satisfies CallToolResult;
      }

      const action = tools.byToolName.get(name);
      if (!action) {
        return errorResult("unknown_action", `unknown tool: ${name}`);
      }

      const invocation: ActionInvocation = {
        id: action.id,
        input: args ?? {},
      };
      // Long-lived server vs CLI mutators: reload keeps per-invocation freshness.
      yield* reloadEffect(ctx);
      const receipt = yield* invokeReceiptEffect(ctx, invocation);

      if (receipt.status === "succeeded") {
        return jsonResult(receipt.output);
      }
      return errorResult(receipt.code, receipt.message, receipt.details);
    }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
  );
}

const listResourcesEffect = Effect.fn("mcp.listResources")(function* (ctx: KbContext) {
  yield* reloadEffect(ctx);
  const names = yield* listViewNamesEffect();
  return {
    resources: names.map((name) => ({
      uri: `${VIEW_URI_PREFIX}${name}`,
      name: `kb view: ${name}`,
      mimeType: "text/html",
    })),
  };
});

const readResourceEffect = Effect.fn("mcp.readResource")(function* (ctx: KbContext, uri: string) {
  if (!uri.startsWith(VIEW_URI_PREFIX)) {
    return yield* domainError("not_found", `unknown resource: ${uri}`);
  }
  const name = uri.slice(VIEW_URI_PREFIX.length);
  yield* reloadEffect(ctx);
  const rendered = yield* renderNamedViewEffect(name, "html");
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
): Effect.fn.Return<Server, DomainError, FileSystem> {
  const ctx = yield* openKbEffect(root);
  const actions = (yield* registryFor(root)).manifestEntries;
  const byToolName = new Map(actions.map((a) => [actionIdToToolName(a.id), a] as const));
  const toolsCtx: McpToolContext = { actions, byToolName };

  // Dedicated MCP tools own these names; skip colliding registry actions so the
  // advertised inputSchema matches callToolEffect (format:null → html).
  const reservedToolNames = new Set([MANIFEST_TOOL, RENDER_TOOL]);
  const tools: Tool[] = [
    ...actions
      .filter((a) => !reservedToolNames.has(actionIdToToolName(a.id)))
      .map(
        (a): Tool => ({
          name: actionIdToToolName(a.id),
          title: a.title,
          description: a.description,
          inputSchema: asObjectSchema(a.inputSchema),
          annotations: {
            title: a.title,
            readOnlyHint: a.mode === "read",
            destructiveHint: a.mode === "apply",
          },
        }),
      ),
    {
      name: MANIFEST_TOOL,
      title: "KB action manifest",
      description: "Return the full kb action registry manifest",
      inputSchema: { type: "object" as const, properties: {} },
      annotations: {
        title: "KB action manifest",
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: RENDER_TOOL,
      title: "Render a kb view",
      description:
        "Render a saved view (.kb/views/<name>.json) as html or md. " +
        `The same content is exposed as ${VIEW_URI_PREFIX}<name> resources.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          view: { type: "string", description: "view name" },
          // Advertised shape matches runtime: null/absent → html (see RenderViewArgs).
          format: {
            anyOf: [{ type: "string", enum: ["html", "md"] }, { type: "null" }],
            default: "html",
            description: "html or md; null or omitted defaults to html",
          },
        },
        required: ["view"],
      },
      annotations: {
        title: "Render a kb view",
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];

  return bindMcpHandlers(ctx, tools, toolsCtx);
}, Effect.provide(bunFileSystemLayer));

/**
 * The MCP SDK boundary. Every request handler must hand the SDK a promise, so
 * this is where kb's Effects are run — a plain function beside the builder,
 * not inside it.
 */
function bindMcpHandlers(ctx: KbContext, tools: Tool[], toolsCtx: McpToolContext) {
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
