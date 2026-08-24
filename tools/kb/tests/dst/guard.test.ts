import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Determinism seam guard (t2-dst).
 *
 * The store's time and identity must come from exactly one owner each — the
 * Effect `Clock` and the seeded Effect `Random`, exposed by `model.ts`. If any
 * store-reachable call site reads the wall clock, `Date`, `Math.random`, or
 * mints a `ulid` directly, a seeded replay silently diverges. This guard fails
 * if a fresh bypass is introduced.
 *
 * Allowlisted (documented) exceptions:
 *   - model.ts            the seam owner (defines nowIso/currentIso/freshId)
 *   - seed.ts, example.ts pure seed builders: `nowIso()` is the *default*
 *                         parameter value, the sanctioned "thread the param,
 *                         default to live implementation" pattern. The Effect
 *                         call sites (services.ts, cli.ts) thread the clock.
 *   - write-lock.ts,      `Date.now()` is a lock spin-timeout, and
 *     durable-replace.ts  a tmp-file name. Neither writes node content, so
 *                         neither contributes store nondeterminism.
 */
const SRC_ROOT = join(import.meta.dir, "..", "..", "src");

// token → where it is permitted. Anything not listed is forbidden everywhere.
const ALLOWED: Record<string, Set<string>> = {
  "Date.now(": new Set(["model.ts", "write-lock.ts", "durable-replace.ts"]),
  "Math.random(": new Set(["model.ts"]),
  "new Date(": new Set(["model.ts"]),
  "ulid(": new Set(["model.ts"]),
  "nowIso(": new Set(["model.ts", "seed.ts", "example.ts"]),
  "Date(": new Set(["model.ts"]),
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

const tokens = Object.keys(ALLOWED);

describe("determinism seam guard", () => {
  test("no store-reachable file reads time/randomness outside the seam owner", async () => {
    const violations: string[] = [];
    for await (const file of tsFiles(SRC_ROOT)) {
      const body = await readFile(file, "utf8");
      const base = file.split(sep).pop()!;
      for (const token of tokens) {
        if (!body.includes(token)) continue;
        const allowed = ALLOWED[token]!;
        if (allowed.has(base)) continue;
        const prefix = relative(SRC_ROOT, file).split(sep).slice(0, -1).join(sep);
        violations.push(
          `${token} in ${prefix ? prefix + sep : ""}${base} (allowed only in: ${[...allowed].join(", ")})`,
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
