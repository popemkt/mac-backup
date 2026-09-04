import { describe, expect, test } from "bun:test";
import { present } from "../src/present.ts";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { sourceFilesUnder } from "../src/import-graph.ts";
import { PACKAGES_ROOT, workspacePackages } from "../src/workspace.ts";

/**
 * Determinism seam guard (t2-dst).
 *
 * The store's time and identity must come from exactly one owner each — the
 * Effect `Clock` and the seeded Effect `Random`, exposed by `@kb/model`'s
 * `model.ts`. If any store-reachable call site reads the wall clock, `Date`,
 * `Math.random`, or mints a `ulid` directly, a seeded replay silently
 * diverges. This guard fails if a fresh bypass is introduced.
 *
 * Scope: every package that can reach the store. `@kb/ui` and
 * `@kb/render-tests` are browser/e2e trees whose rendering legitimately reads
 * the clock and never writes a node.
 *
 * Allowlisted (documented) exceptions:
 *   - model.ts            the seam owner (defines nowIso/currentIso/freshId)
 *   - seed.ts, example.ts pure seed builders: `nowIso()` is the *default*
 *                         parameter value, the sanctioned "thread the param,
 *                         default to live implementation" pattern. The Effect
 *                         call sites (layers.ts, cli.ts) thread the clock.
 *
 * The two former exemptions are closed: `write-lock.ts` reads the spin
 * timeout from `Clock`, `durable-replace.ts` names its temp file from a
 * per-process sequence, and `ext-canvas` stamps `updatedAt` from
 * `currentIso`, so a seeded replay of a canvas write no longer diverges
 * (b6; the bypass was recorded in
 * docs/kb/waves/2026-09-03/reports/w1-workspace.md).
 *
 * Packages come from the workspace reader, not a second walk of `packages/`:
 * where a package sits is the reader's business, and this guard's business is
 * which tokens may appear where.
 */
const NOT_STORE_REACHABLE = new Set(["@kb/ui", "@kb/render-tests"]);

/** One file, named the way a reader can check it: package plus its own path. */
function at(pkg: string, file: string): string {
  return `${pkg} ${file}`;
}

// token → the files where it is permitted. Anything not listed is forbidden
// everywhere. A package name and a package-relative path, not a basename:
// `index.ts` is not a name a guard can reason about, and a path under
// `packages/` would name the package's layer a second time.
const MODEL = at("@kb/model", "src/model.ts");
const ALLOWED: Record<string, Set<string>> = {
  "Date.now(": new Set([MODEL]),
  "Math.random(": new Set([MODEL]),
  "new Date(": new Set([MODEL]),
  "ulid(": new Set([MODEL]),
  "nowIso(": new Set([MODEL, at("@kb/model", "src/seed.ts"), at("@kb/model", "src/example.ts")]),
  "Date(": new Set([MODEL]),
};

const tokens = Object.keys(ALLOWED);

describe("determinism seam guard", () => {
  test("no store-reachable file reads time/randomness outside the seam owner", () => {
    const violations: string[] = [];
    for (const { dir, name } of workspacePackages()) {
      if (NOT_STORE_REACHABLE.has(name)) continue;
      const root = join(PACKAGES_ROOT, dir);
      const src = join(root, "src");
      // A suite package (@kb/render-tests) has no production tree at all.
      if (!existsSync(src)) continue;
      for (const file of sourceFilesUnder(src)) {
        // A declaration file has no call sites, only signatures.
        if (file.endsWith(".d.ts")) continue;
        const body = readFileSync(file, "utf8");
        const where = at(name, relative(root, file).split(sep).join("/"));
        for (const token of tokens) {
          if (!body.includes(token)) continue;
          const allowed = present(ALLOWED[token], "expected ALLOWED[token]");
          if (allowed.has(where)) continue;
          violations.push(`${token} in ${where} (allowed only in: ${[...allowed].join(", ")})`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
