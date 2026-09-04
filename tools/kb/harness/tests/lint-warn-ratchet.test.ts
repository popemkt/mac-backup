import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  BASELINE_PATH,
  collectKnipFindings,
  collectLinterWarnings,
  collectOxlintWarnings,
  type BaselineLanes,
} from "../src/snapshot.ts";
import { ratchetMismatches, unpromotedWarnRules, type OxlintRuleSetting } from "../src/ratchet.ts";
import { WORKSPACE_ROOT } from "../src/workspace.ts";
import { join } from "node:path";

/**
 * Harness check 2: deterministic-debt ratchet.
 *
 * Blocking lint warnings and Knip findings use one mechanism: the committed
 * ledger must equal complete collector output. Any change requires an explicit
 * `bun run harness:snapshot`; a zero count disappears from the regenerated
 * ledger — and a `warn` rule with no debt left is promoted to `error`, so the
 * ledger never hides an unchecked lane. Advisory lint diagnostics remain
 * non-blocking.
 */

describe("lint-warn-ratchet", () => {
  test("baseline file exists and contains valid lanes", () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes;

    expect(typeof baseline.lanes).toBe("object");
    expect(typeof baseline.lanes.blocking).toBe("object");
    expect(typeof baseline.lanes.advisory).toBe("object");
    expect(typeof baseline.lanes.knip).toBe("object");

    for (const lane of [baseline.lanes.blocking, baseline.lanes.advisory, baseline.lanes.knip]) {
      for (const [identity, count] of Object.entries(lane)) {
        expect(identity.length).toBeGreaterThan(0);
        expect(Number.isInteger(count) && count > 0).toBe(true);
      }
    }
  });

  test("a partial improvement fails until the baseline is updated", () => {
    expect(ratchetMismatches({ "eslint/example": 3 }, { "eslint/example": 1 }, "lint")).toEqual([
      "lint eslint/example count changed from 3 to 1; run bun run harness:snapshot",
    ]);
  });

  test("a warn rule with no debt left must be promoted to error", () => {
    expect(unpromotedWarnRules({ "eslint/example": "warn" }, {})).toEqual([
      'eslint/example is "warn" with no debt in the ledger; promote it to "error" in .oxlintrc.json',
    ]);
    expect(
      unpromotedWarnRules({ "eslint/example": ["warn", {}] }, { "eslint/example": 3 }),
    ).toEqual([]);
    expect(unpromotedWarnRules({ "eslint/example": "error" }, {})).toEqual([]);
  });

  test("every warn rule in .oxlintrc.json still has debt in the blocking lane", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes;
    const config = JSON.parse(readFileSync(join(WORKSPACE_ROOT, ".oxlintrc.json"), "utf8")) as {
      rules?: Record<string, OxlintRuleSetting>;
    };
    const unpromoted = unpromotedWarnRules(config.rules ?? {}, {
      ...baseline.lanes.blocking,
      ...baseline.lanes.advisory,
    });
    expect(unpromoted, unpromoted.join("\n")).toEqual([]);
  });

  test("non-JSON collector output is unhealthy, not an empty finding set", () => {
    expect(collectOxlintWarnings(undefined, () => "not-json")).toEqual({
      ok: false,
      findings: {},
    });
  });

  test("blocking lint and Knip lanes exactly match healthy collector output", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes;
    const lint = collectLinterWarnings();
    const knip = collectKnipFindings();

    expect(lint.ok, "oxlint or effect-tsgo failed to execute or decode").toBe(true);
    expect(knip.ok, "Knip failed to execute or decode").toBe(true);

    const mismatches = [
      ...ratchetMismatches(baseline.lanes.blocking, lint.findings, "lint"),
      ...ratchetMismatches(baseline.lanes.knip, knip.findings, "knip"),
    ];
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  }, 120000);
});
