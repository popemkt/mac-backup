import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  BASELINE_PATH,
  baselineAtRatchetBase,
  collectKnipFindings,
  collectLinterWarnings,
  collectOxlintWarnings,
  type BaselineLanes,
} from "../src/snapshot.ts";
import {
  ratchetMismatches,
  ratchetRises,
  unpromotedWarnRules,
  type OxlintRuleSetting,
} from "../src/ratchet.ts";
import { WORKSPACE_ROOT } from "../src/workspace.ts";
import { join } from "node:path";

/**
 * Harness check 2: deterministic-debt ratchet.
 *
 * Blocking lint warnings and Knip findings use one mechanism: the committed
 * ledger must equal complete collector output. Any change requires an explicit
 * `bun run harness:snapshot`; a zero count disappears from the regenerated
 * ledger — and a `warn` rule with no debt left is promoted to `error`, so the
 * ledger never hides an unchecked lane. A snapshot records reality, so it
 * would record new debt too: the ledger is therefore also held to the one at
 * the commit the change forked from, and any count above it fails. Advisory
 * lint diagnostics remain non-blocking.
 */

/** A git that knows only the answers it is given, and fails like git on any other question. */
function scriptedGit(history: Record<string, string>): (args: string[]) => string {
  return (args) => {
    const answer = history[args.join(" ")];
    if (answer === undefined) throw new Error(`git ${args.join(" ")}`);
    return answer;
  };
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

  test("a count above the base, or an identity the base never held, is a rise", () => {
    expect(ratchetRises({ "react/refs": 22 }, { "react/refs": 26 }, "lint")).toEqual([
      "lint react/refs rose from 22 to 26 against the base; drain it instead of raising the baseline",
    ]);
    expect(ratchetRises({}, { "exports:a.ts:X": 1 }, "knip")).toEqual([
      "knip exports:a.ts:X rose from 0 to 1 against the base; drain it instead of raising the baseline",
    ]);
    expect(ratchetRises({ "react/refs": 26 }, { "react/refs": 22 }, "lint")).toEqual([]);
  });

  test("the ratchet base is the fork point, or HEAD's parent on the base branch itself", () => {
    const ledger = JSON.stringify({ lanes: { blocking: {}, advisory: {}, knip: {} } });
    const onBranch = baselineAtRatchetBase(
      scriptedGit({
        "rev-parse HEAD": "head",
        "merge-base HEAD main": "fork",
        "show fork:./lint-warn-baseline.json": ledger,
      }),
    );
    expect(onBranch.ok && onBranch.rev).toBe("fork");
    const onMain = baselineAtRatchetBase(
      scriptedGit({
        "rev-parse HEAD": "head",
        "merge-base HEAD main": "head",
        "rev-parse HEAD^": "parent",
        "show parent:./lint-warn-baseline.json": ledger,
      }),
    );
    expect(onMain.ok && onMain.rev).toBe("parent");
    // Without a base the check cannot pass by default: it reports why.
    expect(baselineAtRatchetBase(scriptedGit({ "rev-parse HEAD": "head" })).ok).toBe(false);
  });

  test("no ledger count rises against the ratchet base", () => {
    const base = baselineAtRatchetBase();
    expect(base.ok, base.ok ? "" : base.reason).toBe(true);
    if (!base.ok) return;
    const current = (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes).lanes;
    const rises = [
      ...ratchetRises(base.lanes.blocking, current.blocking, "lint"),
      ...ratchetRises(base.lanes.knip, current.knip, "knip"),
    ];
    expect(rises, `against ${base.rev}:\n${rises.join("\n")}`).toEqual([]);
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
