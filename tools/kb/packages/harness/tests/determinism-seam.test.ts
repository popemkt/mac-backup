import { describe, expect, test } from "bun:test";
import { present } from "../../model/src/present.ts";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

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
 */
const PACKAGES_ROOT = join(import.meta.dir, "..", "..");
const NOT_STORE_REACHABLE = new Set(["ui", "render-tests"]);

// token → the workspace-relative files where it is permitted. Anything not
// listed is forbidden everywhere. Paths, not basenames: `index.ts` is not a
// name a guard can reason about.
const MODEL = "model/src/model.ts";
const ALLOWED: Record<string, Set<string>> = {
  "Date.now(": new Set([MODEL]),
  "Math.random(": new Set([MODEL]),
  "new Date(": new Set([MODEL]),
  "ulid(": new Set([MODEL]),
  "nowIso(": new Set([MODEL, "model/src/seed.ts", "model/src/example.ts"]),
  "Date(": new Set([MODEL]),
};

async function* tsFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(full);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

async function storeReachableSrcDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for (const entry of await readdir(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || NOT_STORE_REACHABLE.has(entry.name)) continue;
    const src = join(PACKAGES_ROOT, entry.name, "src");
    const stat = await readdir(src).catch(() => null);
    if (stat) dirs.push(src);
  }
  return dirs;
}

const tokens = Object.keys(ALLOWED);

describe("determinism seam guard", () => {
  test("no store-reachable file reads time/randomness outside the seam owner", async () => {
    const violations: string[] = [];
    for (const srcRoot of await storeReachableSrcDirs()) {
      for await (const file of tsFiles(srcRoot)) {
        const body = await readFile(file, "utf8");
        const rel = relative(PACKAGES_ROOT, file).split(sep).join("/");
        for (const token of tokens) {
          if (!body.includes(token)) continue;
          const allowed = present(ALLOWED[token], "expected ALLOWED[token]");
          if (allowed.has(rel)) continue;
          violations.push(`${token} in ${rel} (allowed only in: ${[...allowed].join(", ")})`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
