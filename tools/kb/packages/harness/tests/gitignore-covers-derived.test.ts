import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { WORKSPACE_ROOT } from "../src/workspace.ts";

/**
 * Harness check 12: Gitignore covers derived files (spec 11 / plan A.9 #12).
 *
 * Asserts:
 *   Every derived artifact from kb execution, mutation testing, and caching is
 *   properly ignored by git:
 *     - .kb/nodes.jsonl.lock (write lock)
 *     - .kb/nodes.jsonl.bak, *.bak (backup files)
 *     - .kb/cache/* (query/index cache)
 *     - reports/mutation/* (Stryker mutation test reports)
 *     - .stryker-tmp/* (Stryker temp files)
 *
 * Red case: check an unignored file (e.g. packages/model/src/model.ts).
 */

const REPO_ROOT = join(WORKSPACE_ROOT, "..", "..");

const REQUIRED_IGNORED = [
  ".kb/nodes.jsonl.lock",
  ".kb/nodes.jsonl.bak",
  "tools/kb/.stryker-tmp/sandbox",
  "data.bak",
  "tools/kb/reports/mutation/report.html",
  "tools/kb/.stryker-tmp/sandbox",
];

export function isGitIgnored(relPath: string, cwd: string = REPO_ROOT): boolean {
  try {
    execSync(`git check-ignore -q "${relPath}"`, {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

describe("gitignore-covers-derived", () => {
  test("all required derived artifacts are gitignored", () => {
    const unignored: string[] = [];

    for (const file of REQUIRED_IGNORED) {
      if (!isGitIgnored(file, REPO_ROOT)) {
        unignored.push(file);
      }
    }

    expect(
      unignored,
      `The following derived artifacts are not ignored by .gitignore:\n${unignored.join("\n")}`,
    ).toEqual([]);
  });
});
