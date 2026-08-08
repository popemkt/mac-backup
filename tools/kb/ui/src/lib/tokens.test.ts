import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("kb tokens", () => {
  const tokens = readFileSync(path.join(root, "tokens.css"), "utf8");
  const content = readFileSync(
    path.join(root, "components/outline/node-content.tsx"),
    "utf8",
  );

  it("defines row metric tokens from DESIGN-REFINE W1", () => {
    expect(tokens).toMatch(/--kb-indent:\s*24px/);
    expect(tokens).toMatch(/--kb-row-h:\s*24px/);
    expect(tokens).toMatch(/--kb-text:\s*14\.5px\s*\/\s*1\.6/);
    expect(tokens).toMatch(/--kb-chip:\s*11px\s*\/\s*1\.8/);
    expect(tokens).toMatch(/--kb-field-label:\s*120px/);
    expect(tokens).toMatch(/oklch\(/);
  });

  it("content row uses var(--kb-text) via .kb-text", () => {
    expect(tokens).toMatch(/\.kb-text\s*\{[^}]*var\(--kb-text\)/s);
    expect(content).toMatch(/KB_TEXT_CLASS|kb-text/);
    expect(content).not.toMatch(/text-\[14\.5px\]/);
  });
});
