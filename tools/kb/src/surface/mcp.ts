import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { openKb, reload } from "../context.ts";
import { invoke, manifest } from "../registry.ts";
import type { ActionInvocation } from "../shared/contracts.ts";

const MANIFEST_TOOL = "kb_manifest";

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

/**
 * Build an MCP server bound to a kb root. Does not connect a transport —
 * callers connect stdio (startMcp) or InMemoryTransport (tests).
 */
export async function createMcpServer(root: string): Promise<Server> {
  const ctx = await openKb(root);
  const actions = manifest();
  const byToolName = new Map(
    actions.map((a) => [actionIdToToolName(a.id), a] as const),
  );

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
  ];

  const server = new Server(
    { name: "kb", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      if (name === MANIFEST_TOOL) {
        return jsonResult(manifest());
      }

      const action = byToolName.get(name);
      if (!action) {
        return errorResult("unknown_action", `unknown tool: ${name}`);
      }

      const invocation: ActionInvocation = {
        id: action.id,
        input: args ?? {},
      };
      // The server is long-lived while the CLI mutates the same .kb files;
      // reload keeps per-invocation semantics instead of serving stale state.
      await reload(ctx);
      const receipt = await invoke(ctx, invocation);

      if (receipt.status === "succeeded") {
        return jsonResult(receipt.output);
      }
      return errorResult(receipt.code, receipt.message, receipt.details);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult("internal", message);
    }
  });

  return server;
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

/**
 * Start the kb MCP server on stdio for the given data root.
 * Safe for CLI `kb mcp` to call without importing commander.
 */
export async function startMcp(root: string): Promise<void> {
  const server = await createMcpServer(root);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function parseRoot(argv: string[]): string {
  const idx = argv.indexOf("--root");
  if (idx >= 0) {
    const value = argv[idx + 1];
    if (!value || value.startsWith("-")) {
      throw new Error("missing value for --root");
    }
    return value;
  }
  return process.cwd();
}

if (import.meta.main) {
  try {
    const root = parseRoot(process.argv.slice(2));
    await startMcp(root);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`kb mcp: ${message}`);
    process.exit(1);
  }
}
