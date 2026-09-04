import { describe, expect, test } from "bun:test";
import { countsTowardRatchet, tsgoDiagnosticCounts } from "../src/snapshot.ts";

/**
 * Harness check: ratchet scope for `@effect/tsgo` diagnostics
 * (tools/kb/DESIGN.md, "Ratchet scope").
 *
 * Correctness-severity diagnostics are counted wherever they appear.
 * Suggestion-severity ones — the Effect-native preference lane, emitted by
 * tsgo as `message` — are counted only under the `src/` of a package that is
 * kb, because they state how production code should be written. A test
 * callback that says `async () => { ... }` is a test-runner contract, and a
 * `scope:tooling` package's `src/` is a build script; neither is a claim
 * about how kb models control flow, so neither moves the ledger.
 *
 * Red case: drop the `src/` test from `countsTowardRatchet` and the
 * "test-file suggestion is not counted" expectations below fail; drop the
 * `scope:tooling` test and the harness expectation below fails.
 */
describe("ratchet-scope", () => {
  const srcFile = "/abs/tools/kb/packages/server/src/server.ts";
  const testFile = "/abs/tools/kb/packages/server/tests/ui.test.ts";
  const rootFile = "/abs/tools/kb/packages/render-tests/playwright.config.ts";
  const toolingFile = "/abs/tools/kb/packages/harness/src/snapshot.ts";

  test("suggestion under src/ is counted", () => {
    expect(countsTowardRatchet({ severity: "message", name: "asyncFunction", file: srcFile })).toBe(
      true,
    );
  });

  test("suggestion outside src/ is not counted", () => {
    expect(
      countsTowardRatchet({ severity: "message", name: "asyncFunction", file: testFile }),
    ).toBe(false);
    expect(countsTowardRatchet({ severity: "message", name: "processEnv", file: rootFile })).toBe(
      false,
    );
  });

  test("a scope:tooling package's src/ is not counted in the suggestion lane", () => {
    expect(
      countsTowardRatchet({ severity: "message", name: "globalConsole", file: toolingFile }),
    ).toBe(false);
    // Correctness severity still counts there.
    expect(
      countsTowardRatchet({ severity: "warning", name: "floatingEffect", file: toolingFile }),
    ).toBe(true);
  });

  test("correctness severity is counted everywhere", () => {
    expect(
      countsTowardRatchet({ severity: "warning", name: "floatingEffect", file: testFile }),
    ).toBe(true);
  });

  test("an unnamed or unknown-severity diagnostic is never counted", () => {
    expect(countsTowardRatchet({ severity: "message", file: srcFile })).toBe(false);
    expect(countsTowardRatchet({ severity: "error", name: "floatingEffect", file: srcFile })).toBe(
      false,
    );
  });

  test("counts group by effect/<name> over the scoped subset", () => {
    const counts = tsgoDiagnosticCounts([
      { severity: "message", name: "asyncFunction", file: srcFile },
      { severity: "message", name: "asyncFunction", file: srcFile },
      { severity: "message", name: "asyncFunction", file: testFile },
      { severity: "warning", name: "floatingEffect", file: testFile },
    ]);
    expect(counts).toEqual({ "effect/asyncFunction": 2, "effect/floatingEffect": 1 });
  });
});
