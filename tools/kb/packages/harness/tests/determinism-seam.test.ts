import { describe, expect, test } from "bun:test";
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
 *   - write-lock.ts,      `Date.now()` is a lock spin-timeout, and
 *     durable-replace.ts  a tmp-file name. Neither writes node content, so
 *                         neither contributes store nondeterminism.
 *   - ext-canvas          KNOWN BYPASS, not sanctioned. The bundled canvas
 *                         extension stamps `updatedAt` from the wall clock
 *                         and then persists, so a seeded replay of a canvas
 *                         write diverges. `extensions-bundled/` was outside
 *                         this guard's scan root before the w1 move, which is
 *                         why it was never seen. Recorded in
 *                         docs/kb-waves/2026-09-03/reports/w1-workspace.md;
 *                         closing it means threading the Effect clock through
 *                         the extension contract.
 */
const PACKAGES_ROOT = join(import.meta.dir, "..", "..");
const NOT_STORE_REACHABLE = new Set(["ui", "render-tests"]);

// token → the workspace-relative files where it is permitted. Anything not
// listed is forbidden everywhere. Paths, not basenames: `index.ts` is not a
// name a guard can reason about.
const MODEL = "model/src/model.ts";
const ALLOWED: Record<string, Set<string>> = {
  "Date.now(": new Set([
    MODEL,
    "store-jsonl/src/write-lock.ts",
    "store-jsonl/src/durable-replace.ts",
  ]),
  "Math.random(": new Set([MODEL]),
  "new Date(": new Set([MODEL]),
  "ulid(": new Set([MODEL]),
  "nowIso(": new Set([
    MODEL,
    "model/src/seed.ts",
    "model/src/example.ts",
    "ext-canvas/src/index.ts",
  ]),
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
          const allowed = ALLOWED[token]!;
          if (allowed.has(rel)) continue;
          violations.push(
            `${token} in ${rel} (allowed only in: ${[...allowed].join(", ")})`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
