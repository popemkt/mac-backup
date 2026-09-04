import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  BASELINE_PATH,
  collectKnipFindings,
  collectLinterWarnings,
  collectOxlintWarnings,
  type BaselineLanes,
} from "../src/snapshot.ts";

/**
 * Harness check 2: deterministic-debt ratchet.
 *
 * Blocking lint warnings and Knip findings use one mechanism: the committed
 * ledger must equal complete collector output. Any change requires an explicit
 * `bun run harness:snapshot`; a zero count disappears from the regenerated
 * ledger. Advisory lint diagnostics remain non-blocking.
 */

export function ratchetMismatches(
  baseline: Record<string, number>,
  current: Record<string, number>,
  lane: string,
): string[] {
  const mismatches: string[] = [];
  for (const [identity, baselineCount] of Object.entries(baseline)) {
    const currentCount = current[identity] ?? 0;
    if (currentCount !== baselineCount) {
      mismatches.push(
        `${lane} ${identity} count changed from ${baselineCount} to ${currentCount}; run bun run harness:snapshot`,
      );
    }
  }
  for (const [identity, currentCount] of Object.entries(current)) {
    if (!(identity in baseline) && currentCount > 0) {
      mismatches.push(
        `${lane} ${identity} appeared with count ${currentCount}; run bun run harness:snapshot`,
      );
    }
  }
  return mismatches.toSorted();
}

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
