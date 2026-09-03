import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_ROOT, gitWorkspaceFiles } from "../src/workspace.ts";

/**
 * Harness check 6: No conflict markers (spec 11 / plan A.9 #6).
 *
 * Asserts:
 *   No tracked file under tools/kb contains git merge conflict markers:
 *   `<<<<<<<`, `>>>>>>>`, `|||||||`, or `=======`.
 *
 * Red case: commit or stage a file containing `<<<<<<< HEAD`.
 */

const CONFLICT_PATTERNS = [/^<{7}(?: .+)?$/m, /^>{7}(?: .+)?$/m, /^\|{7}(?: .+)?$/m, /^={7}$/m];

export function findConflictMarkers(root: string = WORKSPACE_ROOT): Array<{
  file: string;
  line: number;
  match: string;
}> {
  const files = gitWorkspaceFiles([], root);

  const violations: Array<{ file: string; line: number; match: string }> = [];

  for (const relFile of files) {
    // Skip binary files and this test file itself (which mentions markers in regex)
    if (relFile.endsWith("no-conflict-markers.test.ts")) continue;

    const absPath = join(root, relFile);
    if (!existsSync(absPath)) continue;

    let content = "";
    try {
      content = readFileSync(absPath, "utf8");
    } catch {
      // Binary file or unreadable
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      for (const pattern of CONFLICT_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: relFile,
            line: i + 1,
            match: line.trim(),
          });
          break;
        }
      }
    }
  }

  return violations;
}

describe("no-conflict-markers", () => {
  test("no tracked file under tools/kb contains unresolved git conflict markers", () => {
    const markers = findConflictMarkers(WORKSPACE_ROOT);
    const formatted = markers.map((m) => `${m.file}:${m.line}: ${m.match}`);

    expect(
      formatted,
      `Found git merge conflict markers in tracked files:\n${formatted.join("\n")}`,
    ).toEqual([]);
  });
});
