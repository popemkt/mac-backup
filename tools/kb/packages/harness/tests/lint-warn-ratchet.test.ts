import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { BASELINE_PATH, collectLinterWarnings, type BaselineLanes } from "../src/snapshot.ts";

/**
 * Harness check 2: Lint warning ratchet (plan A.9 #2 / spec 11).
 *
 * Enforces the ratchet mechanism:
 *   1. Reads packages/harness/lint-warn-baseline.json.
 *   2. Any blocking rule count rise -> FAILS.
 *   3. Any new warning rule absent from baseline -> FAILS (treated as rise from 0).
 *   4. Any blocking rule count dropping to 0 -> FAILS: "promote to error in .oxlintrc.json".
 *   5. Advisory lane rules (typescript/no-deprecated) are reported but never block.
 *
 * Red case: add an artificial warning that increases a blocking rule count.
 */
describe("lint-warn-ratchet", () => {
  test("baseline file exists and contains valid lanes", () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const raw = readFileSync(BASELINE_PATH, "utf8");
    const parsed = JSON.parse(raw) as BaselineLanes;

    expect(typeof parsed.lanes).toBe("object");
    expect(typeof parsed.lanes.blocking).toBe("object");
    expect(typeof parsed.lanes.advisory).toBe("object");

    expect(Object.keys(parsed.lanes.blocking).length).toBeGreaterThan(10);
    expect(Object.keys(parsed.lanes.advisory).length).toBeGreaterThanOrEqual(1);
  });
  test("no blocking rule count rose above baseline, and zero-count rules are promoted", () => {
    const raw = readFileSync(BASELINE_PATH, "utf8");
    const baseline = JSON.parse(raw) as BaselineLanes;
    const current = collectLinterWarnings();

    const rises: string[] = [];
    const promoteCandidates: string[] = [];
    const drops: string[] = [];

    // Check every rule in blocking baseline
    for (const [rule, baselineCount] of Object.entries(baseline.lanes.blocking)) {
      const currentCount = current[rule] ?? 0;

      if (currentCount > baselineCount) {
        rises.push(
          `Rule ${rule} count rose from ${baselineCount} to ${currentCount} (+${currentCount - baselineCount})`,
        );
      } else if (currentCount === 0) {
        promoteCandidates.push(
          `Rule ${rule} count dropped to 0! Promote it to "error" in .oxlintrc.json, then run bun run harness:snapshot`,
        );
      } else if (currentCount < baselineCount) {
        drops.push(
          `Rule ${rule} count dropped from ${baselineCount} to ${currentCount} (-${baselineCount - currentCount})`,
        );
      }
    }

    // Check for new warning rules not present in baseline at all
    const knownRules = new Set([
      ...Object.keys(baseline.lanes.blocking),
      ...Object.keys(baseline.lanes.advisory),
    ]);

    const newRules: string[] = [];
    for (const [rule, count] of Object.entries(current)) {
      if (!knownRules.has(rule) && count > 0) {
        newRules.push(
          `New warning rule ${rule} appeared (${count} violations); add to baseline or fix`,
        );
      }
    }

    if (drops.length > 0) {
      console.log(`[ratchet progress] ${drops.join("\n")}`);
    }

    expect(rises, `Blocking lint rule counts rose above baseline:\n${rises.join("\n")}`).toEqual(
      [],
    );

    expect(
      newRules,
      `New warning rules appeared without baseline entries:\n${newRules.join("\n")}`,
    ).toEqual([]);

    expect(
      promoteCandidates,
      `Rules reached 0 violations and must be promoted to "error":\n${promoteCandidates.join("\n")}`,
    ).toEqual([]);
  }, 60000);
});
