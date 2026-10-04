import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { UI_SRC } from "../src/constraints.ts";
import { sourceFilesUnder } from "../src/import-graph.ts";
import {
  PACKAGES_ROOT,
  WORKSPACE_ROOT,
  axisValues,
  bunfigTestIgnores,
  rootManifest,
  tagsOf,
  workspacePackages,
} from "../src/workspace.ts";

/**
 * What every `scope:browser` package shares with `@kb/ui`, because the shell's
 * Vite build compiles it from source into the one page (DESIGN-UI.md →
 * Extension UI halves): the test runner and the stylesheet's scan.
 *
 * - **The runner.** The two runners split by package (DESIGN.md → Two
 *   runners): a browser package runs on Vitest, every other on `bun test`.
 *   `bunfig.toml`'s `pathIgnorePatterns` keeps exactly the browser packages out
 *   of `bun test packages`, and `test:ui` runs the Vitest `test` script of
 *   every `scope:browser` project. A browser package that `bun test` skipped
 *   and `test:ui` never reached would hold tests nothing runs.
 * - **The scan.** Tailwind's automatic detection reads `@kb/ui`'s own folder,
 *   so `index.css` names each other browser package with `@source`; a class a
 *   package writes outside it compiles to nothing.
 *
 * Red case: drop `"**\/packages/kit/**"` from `bunfig.toml`, the `test` script
 * from `@kb/ui-sdk`, or the `@source` line from `index.css`.
 */

const UI_SRC_ROOT = join(WORKSPACE_ROOT, UI_SRC);

const isBrowser = (tags: string[]) => axisValues(tags, "scope")[0] === "browser";

describe("browser-scope", () => {
  const packages = workspacePackages();

  test("bun test skips exactly the browser packages", () => {
    const ignores = bunfigTestIgnores().map((pattern) => new Bun.Glob(pattern));
    const wrong = packages.flatMap(({ dir, name, manifest }) => {
      const probe = join(PACKAGES_ROOT, dir, "src", "probe.test.ts");
      const skipped = ignores.some((glob) => glob.match(probe));
      const browser = isBrowser(tagsOf(manifest));
      if (skipped === browser) return [];
      return [`${name}: ${browser ? "a browser package bun test runs" : "skipped by bun test"}`];
    });
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  test("test:ui runs every browser package's Vitest suite", () => {
    expect(rootManifest().scripts?.["test:ui"]).toContain("--projects=tag:scope:browser");
    const missing = packages
      .filter(({ manifest }) => isBrowser(tagsOf(manifest)))
      .filter(({ dir }) =>
        [...sourceFilesUnder(join(PACKAGES_ROOT, dir))].some((file) => /\.test\.tsx?$/.test(file)),
      )
      .filter(({ manifest }) => manifest.scripts?.["test"] !== "vp test")
      .map(({ name }) => name);
    expect(missing, `browser packages with tests and no "vp test" script`).toEqual([]);
  });

  test("the stylesheet scans every browser package", () => {
    const css = readFileSync(join(UI_SRC_ROOT, "index.css"), "utf8");
    const sources = [...css.matchAll(/^@source "([^"]+)";$/gm)].map((m) => m[1] ?? "");
    const unscanned = packages
      .filter(({ name, manifest }) => name !== "@kb/ui" && isBrowser(tagsOf(manifest)))
      .filter(({ dir }) => {
        // A source file of the package, named as index.css names paths: from its folder.
        const probe = relative(UI_SRC_ROOT, join(PACKAGES_ROOT, dir, "src", "probe.tsx"));
        return !sources.some((pattern) =>
          [pattern, `${pattern}/**`].some((glob) => new Bun.Glob(glob).match(probe)),
        );
      })
      .map(({ name }) => name);
    expect(unscanned, "browser packages no @source in index.css names").toEqual([]);
  });
});
