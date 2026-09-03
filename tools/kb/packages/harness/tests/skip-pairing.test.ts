import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_ROOT, gitWorkspaceFiles } from "../src/workspace.ts";

/**
 * Harness check 4: Skip pairing (spec 11 / plan A.9 #4).
 *
 * Asserts:
 *   Every `test.skip`, `describe.skip`, `it.skip`, `test.todo`, `it.todo` in any
 *   test file under tools/kb carries a paired debt marker `GAP [[<id>]]` within
 *   3 lines above or on the same line.
 *   `BASELINED_SKIPS` is empty and stale-checked.
 *
 * Red case: add an unpaired `test.skip(...)` without a GAP marker.
 */

export const BASELINED_SKIPS: Record<string, string[]> = {};

const SKIP_PATTERN = /\b(?:test|describe|it)\.(?:skip|todo)\b/;
const GAP_PATTERN = /GAP\s+\[\[([^\]]+)\]\]/;

export function findUnpairedSkips(root: string = WORKSPACE_ROOT): Array<{
  file: string;
  line: number;
  snippet: string;
}> {
  const testFiles = gitWorkspaceFiles(["*test*", "*spec*"], root).filter((s) =>
    /\.(ts|tsx|js|jsx)$/.test(s),
  );

  const unpaired: Array<{ file: string; line: number; snippet: string }> = [];
  for (const relFile of testFiles) {
    if (relFile.endsWith("skip-pairing.test.ts")) continue;
    const absPath = join(root, relFile);
    if (!existsSync(absPath)) continue;
    const lines = readFileSync(absPath, "utf8").split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (!SKIP_PATTERN.test(line)) continue;
      const grandfathered = BASELINED_SKIPS[relFile] ?? [];
      if (grandfathered.some((sub) => line.includes(sub))) continue;

      // Look within 3 lines above or same line for GAP [[id]]
      const start = Math.max(0, i - 3);
      const window = lines.slice(start, i + 1).join("\n");

      if (!GAP_PATTERN.test(window)) {
        unpaired.push({
          file: relFile,
          line: i + 1,
          snippet: line.trim(),
        });
      }
    }
  }

  return unpaired;
}

describe("skip-pairing", () => {
  test("BASELINED_SKIPS has no stale entries", () => {
    const stale: string[] = [];
    for (const [file, snippets] of Object.entries(BASELINED_SKIPS)) {
      const absPath = join(WORKSPACE_ROOT, file);
      if (!existsSync(absPath)) {
        stale.push(`${file} (file does not exist)`);
        continue;
      }
      const content = readFileSync(absPath, "utf8");
      for (const snippet of snippets) {
        if (!content.includes(snippet)) {
          stale.push(`${file}: snippet '${snippet}' no longer present`);
        }
      }
    }
    expect(stale, `Stale BASELINED_SKIPS entries: ${stale.join(", ")}`).toEqual([]);
  });

  test("every skipped or todo test has a paired GAP [[id]] marker", () => {
    const unpaired = findUnpairedSkips(WORKSPACE_ROOT);
    const formatted = unpaired.map((u) => `${u.file}:${u.line}: ${u.snippet}`);

    expect(
      formatted,
      `Found tests skipped without a paired GAP [[id]] marker within 3 lines:\n${formatted.join("\n")}`,
    ).toEqual([]);
  });
});
