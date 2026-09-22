import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { WORKSPACE_ROOT } from "../src/workspace.ts";

/**
 * The vendored oxlint rules (`harness/lint/`) are proven by their own
 * `RuleTester` cases, one `*.rule-cases.ts` beside each rule. `RuleTester`
 * parses through oxlint's raw-transfer binding, which runs on Node and not on
 * Bun — the same Node oxlint already needs to host JS plugins at all — so each
 * case file runs as a Node process and a failing case is a non-zero exit.
 */
const LINT_ROOT = join(WORKSPACE_ROOT, "harness", "lint");

const caseFiles = readdirSync(LINT_ROOT, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".rule-cases.ts"))
  .toSorted((a, b) => a.localeCompare(b));

describe("lint-plugin-rules", () => {
  test("every vendored rule has its cases", () => {
    expect(caseFiles.length).toBeGreaterThan(0);
  });

  for (const file of caseFiles) {
    test(relative(LINT_ROOT, join(LINT_ROOT, file)), () => {
      const run = Bun.spawnSync(["node", join(LINT_ROOT, file)], { cwd: WORKSPACE_ROOT });
      expect(run.exitCode, run.stderr.toString()).toBe(0);
    });
  }
});
