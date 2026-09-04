import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_ROOT, workspacePackages } from "../src/workspace.ts";

/**
 * A package's public surface is one curated barrel of named exports.
 *
 * `export * from` is forbidden: it makes the surface whatever the file
 * happens to contain today, so nothing can be internal and every rename is a
 * breaking change nobody sees. `export * as ns` is fine — it names one thing.
 * Red case (demonstrated in the w1 report): add `export * from "./doc.ts"` to
 * @kb/canvas's barrel.
 *
 * A package with `"exports": {}` states it has no importable surface (the
 * suites and the app shell). That is a claim the graph can check, unlike a
 * missing field.
 */
describe("public-surface", () => {
  const packages = workspacePackages();

  test("exports is either empty or exactly the src/index.ts barrel", () => {
    const bad: string[] = [];
    for (const { dir, manifest } of packages) {
      const exports = manifest.exports;
      if (exports === undefined) {
        bad.push(`${dir}: no exports field`);
        continue;
      }
      const shape = JSON.stringify(exports);
      if (shape === "{}") continue;
      if (shape !== JSON.stringify({ ".": "./src/index.ts" })) {
        bad.push(`${dir}: exports is ${shape}`);
        continue;
      }
      if (!existsSync(join(PACKAGES_ROOT, dir, "src", "index.ts"))) {
        bad.push(`${dir}: exports points at a missing src/index.ts`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("no barrel re-exports a whole module", () => {
    const bad: string[] = [];
    for (const { dir, manifest } of packages) {
      if (JSON.stringify(manifest.exports) === "{}") continue;
      const barrel = join(PACKAGES_ROOT, dir, "src", "index.ts");
      if (!existsSync(barrel)) continue;
      const body = readFileSync(barrel, "utf8");
      for (const [index, line] of body.split("\n").entries()) {
        // `export * as ns from` names one thing; bare `export * from` does not.
        if (/^\s*export\s+\*\s+from\s/.test(line)) {
          bad.push(`${dir}/src/index.ts:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("no barrel re-exports another package's symbols", () => {
    // A barrel that forwards @kb/other is a second name for someone else's
    // surface: two places to change, and the graph edge lies about why.
    const bad: string[] = [];
    for (const { dir, manifest } of packages) {
      if (JSON.stringify(manifest.exports) === "{}") continue;
      const barrel = join(PACKAGES_ROOT, dir, "src", "index.ts");
      if (!existsSync(barrel)) continue;
      const body = readFileSync(barrel, "utf8");
      for (const [index, line] of body.split("\n").entries()) {
        if (/^\s*export\s.*\sfrom\s+["']@kb\//.test(line)) {
          bad.push(`${dir}/src/index.ts:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
