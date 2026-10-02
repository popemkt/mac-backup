import { Effect } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { asObjectSchema, failed, mcpToolHints, mcpToolName, mcpToolResult } from "@kb/contracts";
import type { AgentTurn } from "@kb/agent";

/** The in-process MCP server's name; the model sees the tools as `mcp__kb__<tool>`. */
export const KB_TOOL_SERVER = "kb";

/**
 * A turn's tools as an in-process MCP server: each of the turn's actions as
 * the MCP tool `kb mcp` would list for it (`mcp-tool.ts` in contracts), and
 * every call routed to `turn.call`, which runs it as its mode says. `signal`
 * is the turn's: when it aborts, a call still running is interrupted.
 */
export function kbToolServer(turn: AgentTurn, signal: AbortSignal): McpServer {
  const byName = new Map(turn.tools.map((entry) => [mcpToolName(entry.id), entry]));
  const server = new McpServer(
    { name: KB_TOOL_SERVER, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  // The registry's tools carry JSON Schemas, which the SDK's `tool()` helper
  // (zod shapes only) cannot take, so the server answers the two requests
  // itself, as `kb mcp` does.
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...byName].map(([name, entry]) => ({
      name,
      title: entry.title,
      description: entry.description,
      inputSchema: asObjectSchema(entry.inputSchema),
      annotations: { title: entry.title, ...mcpToolHints(entry.mode) },
      // Kept in the prompt rather than behind tool search: these are all there is.
      _meta: { "anthropic/alwaysLoad": true },
    })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name } = request.params;
    const entry = byName.get(name);
    const receipt =
      entry === undefined
        ? Effect.succeed(failed(name, "unknown_action", `unknown tool: ${name}`))
        : turn.call(entry.id, request.params.arguments ?? {});
    return Effect.runPromise(receipt.pipe(Effect.map(mcpToolResult)), { signal });
  });
  return server;
}
