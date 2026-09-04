/**
 * The deterministic-debt ratchet, as pure functions over the committed ledger.
 *
 * Two halves of the canonical two-mechanism rule (AGENTS.md, Drift markers):
 * the ledger equals reality exactly (`ratchetMismatches`), and a `warn` rule
 * whose debt reached zero is promoted to `error` rather than left as a silent
 * lane (`unpromotedWarnRules`). The tests in `lint-warn-ratchet.test.ts` bind
 * them to the live collectors and `.oxlintrc.json`.
 */

/** Every identity whose ledger count differs from the collector's, either way. */
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

/** Oxlint rule severities as `.oxlintrc.json` writes them: a string or `[severity, options]`. */
export type OxlintRuleSetting = string | readonly [string, ...unknown[]];

function severityOf(setting: OxlintRuleSetting): string {
  return typeof setting === "string" ? setting : setting[0];
}

/**
 * `warn` rules with no debt left. A rule sits at `warn` only while the ledger
 * holds its count; at zero it is promoted to `error` in `.oxlintrc.json`, and
 * a rule that is `warn` yet absent from the ledger is a lane nothing checks.
 */
export function unpromotedWarnRules(
  rules: Record<string, OxlintRuleSetting>,
  ledger: Record<string, number>,
): string[] {
  const unpromoted: string[] = [];
  for (const [rule, setting] of Object.entries(rules)) {
    if (severityOf(setting) !== "warn") continue;
    if ((ledger[rule] ?? 0) > 0) continue;
    unpromoted.push(
      `${rule} is "warn" with no debt in the ledger; promote it to "error" in .oxlintrc.json`,
    );
  }
  return unpromoted.toSorted();
}
