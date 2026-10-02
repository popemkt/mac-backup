import type { ActionMode, ActionReceipt } from "./actions.ts";

/**
 * An action as an MCP tool: its name, its behaviour hints and its result.
 * Stated once, because more than one thing projects the registry onto MCP
 * tools (`kb mcp`, and an agent runtime that hands its model an in-process
 * MCP server), and an agent should see the same tool for the same action
 * through either.
 */

/**
 * The tool name of an action: its id with `.` turned into `_`, since MCP
 * clients and model APIs take `[A-Za-z0-9_-]` names. The mangle cannot be
 * reversed, so a projection keeps its own table back to the id.
 */
export function mcpToolName(actionId: string): string {
  return actionId.replaceAll(".", "_");
}

/** MCP's behaviour hints, as plain data. */
export interface McpToolHints {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

/**
 * MCP's behaviour hints, taken only from the declared mode. A read is
 * read-only and idempotent. A write is treated as possibly destructive and
 * not idempotent, because the mode claims neither. Every action, read or
 * write, touches only its kb root, never an open world of outside entities.
 * MCP has no hint for approval.
 */
export function mcpToolHints(mode: ActionMode): McpToolHints {
  const reads = mode.kind === "read";
  return {
    readOnlyHint: reads,
    destructiveHint: !reads,
    idempotentHint: reads,
    openWorldHint: false,
  };
}

/**
 * An MCP `CallToolResult`, as far as a receipt fills one: one text block,
 * JSON. Mutable and a type literal, as the MCP SDK's own type is, so that
 * it is one.
 */
export type McpToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
};

/**
 * A receipt as a tool result: the output as JSON when it succeeded, else an
 * `isError` result whose JSON is `{code, message, details?}`.
 */
export function mcpToolResult(receipt: ActionReceipt): McpToolResult {
  if (receipt.status === "succeeded") {
    return { content: [{ type: "text", text: JSON.stringify(receipt.output) }] };
  }
  const { code, message, details } = receipt;
  const body = { code, message, ...(details === undefined ? {} : { details }) };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}
