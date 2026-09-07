import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reExportsOf, resolvedImports, surfaceBypass } from "../src/import-graph.ts";
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

  /** The `src/index.ts` of every package that claims a surface. */
  function barrels(): Array<{ dir: string; path: string }> {
    return packages
      .filter(({ manifest }) => JSON.stringify(manifest.exports) !== "{}")
      .map(({ dir }) => ({ dir, path: join(PACKAGES_ROOT, dir, "src", "index.ts") }))
      .filter(({ path }) => existsSync(path));
  }

  test("no barrel re-exports a whole module", () => {
    const bad: string[] = [];
    for (const { dir, path } of barrels()) {
      for (const { specifier, star } of reExportsOf(path, readFileSync(path, "utf8"))) {
        // `export * as ns from` names one thing; bare `export * from` does not.
        if (star) bad.push(`${dir}/src/index.ts: export * from "${specifier}"`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("every cross-package import names the package it reaches", () => {
    // The barrel is only the surface if nothing can go around it. A
    // `@kb/other/src/thing.ts` subpath and a relative path that climbs out of
    // its own package both reach code the target never published, and neither
    // is recorded by any manifest — it resolves by accident of hoisting.
    // Red case (import-graph fixtures): see tests/import-graph.test.ts.
    const bypasses = resolvedImports()
      .map((imp) => surfaceBypass(imp))
      .filter((message): message is string => message !== undefined)
      .toSorted();
    expect(bypasses, bypasses.join("\n")).toEqual([]);
  });

  test("no barrel re-exports another package's symbols", () => {
    // A barrel that forwards @kb/other is a second name for someone else's
    // surface: two places to change, and the graph edge lies about why.
    const bad: string[] = [];
    for (const { dir, path } of barrels()) {
      for (const { specifier } of reExportsOf(path, readFileSync(path, "utf8"))) {
        if (specifier.startsWith("@kb/")) {
          bad.push(`${dir}/src/index.ts: re-exports from "${specifier}"`);
        }
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
