import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { WORKSPACE_ROOT, gitWorkspaceFiles, rootManifest } from "../src/workspace.ts";

/**
 * Harness check 1: Lint scope coverage (spec 11 / plan A.9 #1).
 *
 * Asserts:
 *   1. The `lint` script in tools/kb/package.json defines lint scopes.
 *   2. Every scope path extracted from the script exists on disk.
 *   3. Every tracked and untracked-not-ignored `*.ts` / `*.tsx` file under
 *      tools/kb falls in *exactly one* lint scope.
 *   4. Any excluded paths in EXCLUDED_BY_DECISION are documented and
 *      stale-checked.
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
    if (!token) continue;
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

export function allWorkspaceTsFiles(root: string = WORKSPACE_ROOT): string[] {
  const tracked = gitWorkspaceFiles(["*.ts", "*.tsx"], root);
  const untracked = gitWorkspaceFiles(["--others", "--exclude-standard", "*.ts", "*.tsx"], root);
  return [...new Set([...tracked, ...untracked])].sort();
}

describe("lint-scope-coverage", () => {
  const manifest = rootManifest();
  const lintScript = manifest.scripts?.lint;

  test("the lint script specifies at least one valid scope", () => {
    expect(typeof lintScript).toBe("string");
    const scopes = parseLintScopes(lintScript ?? "");
    expect(scopes.length).toBeGreaterThanOrEqual(1);

    for (const scope of scopes) {
      const abs = isAbsolute(scope) ? scope : join(WORKSPACE_ROOT, scope);
      expect(existsSync(abs)).toBe(true);
    }
  });

  test("every TypeScript file under tools/kb falls in exactly one lint scope", () => {
    const scopes = parseLintScopes(lintScript ?? "").map((s) => normalize(s).replace(/\/$/, ""));

    const tsFiles = allWorkspaceTsFiles(WORKSPACE_ROOT);
    expect(tsFiles.length).toBeGreaterThan(50);

    const unassigned: string[] = [];
    const multipleAssigned: string[] = [];

    for (const file of tsFiles) {
      const norm = normalize(file);

      // Check if excluded
      const isExcluded = EXCLUDED_BY_DECISION.some(
        (ex) => norm === ex || norm.startsWith(`${ex}/`),
      );
      if (isExcluded) continue;

      const matchingScopes = scopes.filter((s) => norm === s || norm.startsWith(`${s}/`));

      if (matchingScopes.length === 0) {
        unassigned.push(norm);
      } else if (matchingScopes.length > 1) {
        multipleAssigned.push(`${norm} matches: ${matchingScopes.join(", ")}`);
      }
    }

    expect(
      unassigned,
      `Unlinted TypeScript files not covered by any lint scope: ${unassigned.join("\n")}`,
    ).toEqual([]);

    expect(
      multipleAssigned,
      `TypeScript files matching multiple lint scopes: ${multipleAssigned.join("\n")}`,
    ).toEqual([]);
  });
});
