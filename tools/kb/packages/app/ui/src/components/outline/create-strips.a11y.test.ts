/**
 * i10 item 5 — the outline's create strips: keyboard-reachable buttons.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outlineDir = path.dirname(fileURLToPath(import.meta.url));

describe("outline create strips a11y (i10 item 5)", () => {
  it("create strips are keyboard-reachable buttons", () => {
    const block = readFileSync(path.join(outlineDir, "node-block.tsx"), "utf8");
    const editor = readFileSync(path.join(outlineDir, "outline-editor.tsx"), "utf8");
    for (const src of [block, editor]) {
      expect(src).toMatch(/data-create-child-zone[\s\S]*role="button"/);
      expect(src).toContain('aria-label="New');
      expect(src).toContain("focus-visible:ring-2");
    }
  });
});
