import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_ROOT, gitWorkspaceFiles } from "../src/workspace.ts";

/**
 * Coverage and mutation score are signals a human reads, never gates
 * (DESIGN.md → Testing doctrine: "Coverage is a signal", "Mutation score is
 * advisory"). The two rules are only honest if nothing turns either number
 * into a pass/fail, so this is the check that nothing does:
 *
 *   1. no runner config in the workspace sets a coverage threshold — bun's
 *      `coverageThreshold`, Vitest's `coverage.thresholds`;
 *   2. Stryker's config sets no `thresholds.break`, the one setting that
 *      makes a mutation run fail on its score, and seeds fast-check, so the
 *      survivor list a human reads is the same list twice;
 *   3. the mutation run is in no workflow that gates a change (`validate.yml`).
 *
 * Red cases: add `coverageThreshold = 0.8` under `[test]` in bunfig.toml; set
 * `"thresholds": { "break": 60 }` in stryker.config.json; add a
 * `bun run test:mutation` step to validate.yml.
 */

const REPO_ROOT = join(WORKSPACE_ROOT, "..", "..");
const read = (path: string) => readFileSync(join(WORKSPACE_ROOT, path), "utf8");

/** Every runner config a coverage threshold could live in. */
function runnerConfigs(): string[] {
  return gitWorkspaceFiles(["bunfig.toml", "*/bunfig.toml", "*vite.config.*", "*vitest.config.*"]);
}

/** A coverage threshold, in any of the forms bun and Vitest accept. */
export const COVERAGE_THRESHOLD = /coverageThreshold|thresholds\s*[:=]/;

describe("advisory-signals", () => {
  test("no runner config sets a coverage threshold", () => {
    const configs = runnerConfigs();
    expect(configs).toContain("bunfig.toml");
    const gated = configs.filter((path) => COVERAGE_THRESHOLD.test(read(path)));
    expect(gated, `coverage thresholds found in:\n${gated.join("\n")}`).toEqual([]);
  });

  test("the threshold pattern sees every form a threshold takes", () => {
    expect(COVERAGE_THRESHOLD.test("coverageThreshold = 0.8")).toBe(true);
    expect(COVERAGE_THRESHOLD.test("coverage: { thresholds: { lines: 80 } }")).toBe(true);
    expect(COVERAGE_THRESHOLD.test('coverage: { provider: "v8" }')).toBe(false);
  });

  test("stryker never fails a run on its score, and its run is seeded", () => {
    const config = JSON.parse(read("stryker.config.json")) as {
      thresholds?: { break?: number | null };
      commandRunner?: { command?: string };
    };
    expect(config.thresholds?.break ?? null).toBeNull();
    // A signal is only worth reading if it is the same signal twice: the
    // preload in bunfig.toml seeds fast-check when this variable is set.
    expect(config.commandRunner?.command ?? "").toMatch(/^KB_FAST_CHECK_SEED=\d+ bun test /);
    expect(read("bunfig.toml")).toContain("packages/app/test-kit/src/fast-check-seed.ts");
  });

  test("no gating workflow runs mutation testing", () => {
    const validate = readFileSync(join(REPO_ROOT, ".github/workflows/validate.yml"), "utf8");
    expect(validate).not.toContain("test:mutation");
    expect(validate).not.toContain("stryker");
  });
});
