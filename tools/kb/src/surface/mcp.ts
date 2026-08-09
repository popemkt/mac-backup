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
import {
  bunFileSystemLayer,
  kbRuntimeLayer,
  openKbEffect,
  reloadEffect,
  type KbContext,
} from "../context.ts";
import {
  invokeReceiptEffect,
  registryFor,
  type ManifestEntry,
} from "../registry.ts";
import type { ActionInvocation } from "../shared/contracts.ts";
import {
  listViewNamesEffect,
  renderNamedViewEffect,
} from "../render/index.ts";
import { resolveRootEffect } from "./root.ts";

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

function errorResult(
  code: string,
  message: string,
  details?: unknown,
): CallToolResult {
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
 * Map typed Failures, Die defects, and Interruptions to an `isError` tool
 * result so `Effect.runPromise` never rejects at the MCP CallTool edge.
 */
export function containToolResult<R>(
  effect: Effect.Effect<CallToolResult, unknown, R>,
): Effect.Effect<CallToolResult, never, R> {
  return effect.pipe(
    Effect.catchCause((cause) =>
      Effect.succeed(errorResult("internal", causeMessage(cause))),
    ),
  );
}

/** Canonical JSON-RPC -32603 for resource-handler failures/defects. */
export function mcpInternalError(cause: Cause.Cause<unknown>): McpError {
  return new McpError(ErrorCode.InternalError, causeMessage(cause));
}

export interface McpToolContext {
  actions: readonly ManifestEntry[];
  byToolName: Map<string, ManifestEntry>;
}

/**
 * Effect program for one MCP CallTool request. Failures and defects are mapped
 * to {@link CallToolResult} with `isError` — the error channel is empty.
 */
export function callToolEffect(
  ctx: KbContext,
  name: string,
  args: unknown,
  tools: McpToolContext,
): Effect.Effect<CallToolResult, never, never> {
  return containToolResult(
    Effect.gen(function* () {
      if (name === MANIFEST_TOOL) {
        return jsonResult(tools.actions);
      }

      if (name === RENDER_TOOL) {
        const decoded = yield* Schema.decodeUnknownEffect(RenderViewArgs)(
          args ?? {},
        ).pipe(Effect.catch(() => Effect.succeed(null)));
        if (!decoded) {
          return errorResult(
            "invalid_input",
            "expected {view: string, format?: 'html'|'md'}",
          );
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

export const listResourcesEffect = Effect.fn("mcp.listResources")(
  function* (ctx: KbContext) {
    yield* reloadEffect(ctx);
    const names = yield* listViewNamesEffect();
    return {
      resources: names.map((name) => ({
        uri: `${VIEW_URI_PREFIX}${name}`,
        name: `kb view: ${name}`,
        mimeType: "text/html",
      })),
    };
  },
);

export const readResourceEffect = Effect.fn("mcp.readResource")(
  function* (ctx: KbContext, uri: string) {
    if (!uri.startsWith(VIEW_URI_PREFIX)) {
      return yield* Effect.fail(new Error(`unknown resource: ${uri}`));
    }
    const name = uri.slice(VIEW_URI_PREFIX.length);
    yield* reloadEffect(ctx);
    const rendered = yield* renderNamedViewEffect(name, "html");
    return {
      contents: [{ uri, mimeType: "text/html", text: rendered.content }],
    };
  },
);

/**
 * Run a resource Effect to an Exit, then throw {@link McpError} (-32603) on
 * any Failure/Die so the Promise edge never surfaces an unmapped reject.
 */
async function runResourceHandler<A>(
  effect: Effect.Effect<A, unknown, never>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw mcpInternalError(exit.cause);
}

/**
 * Build an MCP server bound to a kb root. Does not connect a transport —
 * callers connect stdio (startMcp) or InMemoryTransport (tests).
 */
export async function createMcpServer(root: string): Promise<Server> {
  const ctx = await Effect.runPromise(
    openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)),
  );
  const actions = (await registryFor(root)).manifestEntries;
  const byToolName = new Map(
    actions.map((a) => [actionIdToToolName(a.id), a] as const),
  );
  const toolsCtx: McpToolContext = { actions, byToolName };

  const tools: Tool[] = [
    ...actions.map(
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
          format: { type: "string", enum: ["html", "md"], default: "html" },
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

  const server = new Server(
    { name: "kb", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  // MCP Apps backbone: each saved view is a ui:// html resource.
  server.setRequestHandler(ListResourcesRequestSchema, async () =>
    runResourceHandler(
      listResourcesEffect(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))),
    ),
  );

  server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
    runResourceHandler(
      readResourceEffect(ctx, request.params.uri).pipe(
        Effect.provide(kbRuntimeLayer(ctx)),
      ),
    ),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // callToolEffect already provides kbRuntimeLayer and maps Fail/Die → isError.
    return Effect.runPromise(callToolEffect(ctx, name, args, toolsCtx));
  });

  return server;
}

/**
 * Start the kb MCP server on stdio for the given data root.
 * Safe for CLI `kb mcp` to call without importing commander.
 */
export async function startMcp(root: string): Promise<void> {
  const server = await createMcpServer(root);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function parseRoot(argv: string[]): Promise<string> {
  const idx = argv.indexOf("--root");
  if (idx >= 0) {
    const value = argv[idx + 1];
    if (!value || value.startsWith("-")) {
      throw new Error("missing value for --root");
    }
    return value;
  }
  // MCP clients launch with cwd = project dir; walk upward to find .kb/.
  return Effect.runPromise(
    resolveRootEffect().pipe(Effect.provide(bunFileSystemLayer)),
  );
}

if (import.meta.main) {
  try {
    const root = await parseRoot(process.argv.slice(2));
    await startMcp(root);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`kb mcp: ${message}`);
    process.exit(1);
  }
}
