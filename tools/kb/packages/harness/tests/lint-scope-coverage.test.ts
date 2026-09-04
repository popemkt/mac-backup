import { describe, expect, test } from "bun:test";
import {
  allWorkspaceTsFiles,
  assignToScopes,
  missingScopes,
  type PathScope,
} from "../src/scopes.ts";
import { rootManifest } from "../src/workspace.ts";

/**
 * Harness check 1: Lint scope coverage (spec 11 / plan A.9 #1).
 *
 * The `lint` script's positional arguments are the lint scopes. Every
 * TypeScript file under tools/kb must fall in exactly one of them, so no file
 * is linted twice under different configs and none is linted by nothing.
 * Scope assignment itself lives in `@kb/harness`'s `scopes` reader, shared
 * with `typecheck-scope`.
 *
 * Red case: add an unlinted file outside the scopes (e.g. tools/kb/unlinted.ts).
 */

const EXCLUDED_BY_DECISION = [
  "packages/ext-sdk/generated",
  "packages/ui/dist",
  "packages/ui/storybook-static",
];

export function parseLintScopes(lintScript: string): string[] {
  // Parse command arguments, skipping flags and options like --config <file>
  const tokens = lintScript.split(/\s+/);
  const scopes: string[] = [];

  let skipNext = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined || token === "") continue;
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (i === 0) continue; // "oxlint"
    if (token === "--config" || token === "-c") {
      skipNext = true;
      continue;
    }
    if (token.startsWith("-")) continue; // --type-aware, --fix, etc.

    scopes.push(token);
  }

  return scopes;
}

describe("lint-scope-coverage", () => {
  const manifest = rootManifest();
  const lintScript = manifest.scripts?.lint;
  const scopes: PathScope[] = parseLintScopes(lintScript ?? "").map((path) => ({
    path,
    source: "package.json scripts.lint",
  }));

  test("the lint script specifies at least one valid scope", () => {
    expect(typeof lintScript).toBe("string");
    expect(scopes.length).toBeGreaterThanOrEqual(1);

    const missing = missingScopes(scopes);
    expect(missing, missing.join("\n")).toEqual([]);
  });

  test("every TypeScript file under tools/kb falls in exactly one lint scope", () => {
    const tsFiles = allWorkspaceTsFiles();
    expect(tsFiles.length).toBeGreaterThan(50);

    const { unassigned, multiple } = assignToScopes(tsFiles, scopes, EXCLUDED_BY_DECISION);

    expect(
      unassigned,
      `Unlinted TypeScript files not covered by any lint scope: ${unassigned.join("\n")}`,
    ).toEqual([]);

    expect(
      multiple,
      `TypeScript files matching multiple lint scopes: ${multiple.join("\n")}`,
    ).toEqual([]);
  });
});
