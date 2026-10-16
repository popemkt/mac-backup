/**
 * An action's mode: what invoking it does, read by every surface. These hold
 * the vocabulary (what a mode may say) and its one MCP projection.
 */
import { describe, expect, test } from "bun:test";
import { isActionMode, mcpToolHints } from "../src/index.ts";

describe("action mode", () => {
  test("either kind may say it reaches outside its root; nothing else is added", () => {
    expect(isActionMode({ kind: "read", outsideRoot: true })).toBe(true);
    expect(isActionMode({ kind: "write", approval: "required", outsideRoot: true })).toBe(true);
    expect(isActionMode({ kind: "read", outsideRoot: false })).toBe(false);
    expect(isActionMode({ kind: "read", approval: "required" })).toBe(false);
  });

  test("MCP's open world is exactly an action that reaches outside its root", () => {
    expect(mcpToolHints({ kind: "read" }).openWorldHint).toBe(false);
    expect(mcpToolHints({ kind: "write" }).openWorldHint).toBe(false);
    expect(mcpToolHints({ kind: "read", outsideRoot: true })).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(mcpToolHints({ kind: "write", outsideRoot: true }).openWorldHint).toBe(true);
  });
});
