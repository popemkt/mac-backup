import { describe, expect, test } from "bun:test";
import { rootManifest, workspacePackages, type PackageManifest } from "../src/workspace.ts";

/**
 * Harness check 9: Scripts chain exists (spec 11 / plan A.9 #9).
 *
 * Asserts:
 *   1. Every `bun run <script>`, `npm run <script>`, `pnpm run <script>`
 *      referenced in any package.json script exists in the target package.
 *   2. No `prepare`, `preinstall`, or `postinstall` script executes a compiler
 *      or build step (`tsc`, `build`, `compile`, `bundle`).
 *
 * Red case: reference a non-existent script in a chained command.
 */

const COMPILE_TOKENS = ["tsc", "build", "compile", "bundle", "vp build"];

export function checkScriptChains(
  pkgName: string,
  manifest: PackageManifest,
  allPackages: Map<string, PackageManifest>,
): string[] {
  const scripts = manifest.scripts ?? {};
  const violations: string[] = [];

  for (const [scriptName, scriptBody] of Object.entries(scripts)) {
    // 1. Check for compiler calls in lifecycle scripts
    if (scriptName === "prepare" || scriptName === "postinstall" || scriptName === "preinstall") {
      for (const token of COMPILE_TOKENS) {
        if (scriptBody.includes(token)) {
          violations.push(
            `${pkgName} script "${scriptName}" calls compiler token "${token}": "${scriptBody}"`,
          );
        }
      }
    }

    // 2. Check for chained script references
    // Matches "bun run <script>", "npm run <script>", etc.
    const runMatches = scriptBody.matchAll(/(?:bun|npm|pnpm|yarn)\s+run\s+([a-zA-Z0-9:_-]+)/g);
    for (const match of runMatches) {
      const target = match[1];
      if (!target || target === "--filter") continue;

      // Check if target script exists in current manifest
      if (!(target in scripts)) {
        violations.push(
          `${pkgName} script "${scriptName}" chains to "${target}", but "${target}" is not defined in ${pkgName}`,
        );
      }
    }

    // Matches filtered commands: "bun run --filter <pkg> <script>"
    const filterMatches = scriptBody.matchAll(
      /(?:bun|npm|pnpm|yarn)\s+run\s+--filter\s+([@a-zA-Z0-9/_-]+)\s+([a-zA-Z0-9:_-]+)/g,
    );
    for (const match of filterMatches) {
      const targetPkg = match[1];
      const targetScript = match[2];
      if (!targetPkg || !targetScript) continue;
      const pkg = allPackages.get(targetPkg);
      if (!pkg) {
        violations.push(`${pkgName} script "${scriptName}" targets unknown package "${targetPkg}"`);
      } else if (!pkg.scripts || !(targetScript in pkg.scripts)) {
        violations.push(
          `${pkgName} script "${scriptName}" targets "${targetPkg} ${targetScript}", but script does not exist`,
        );
      }
    }
  }

  return violations;
}

describe("scripts-chain-exists", () => {
  const root = rootManifest();
  const packages = workspacePackages();
  const allPackages = new Map<string, PackageManifest>();
  allPackages.set(root.name ?? "root", root);
  for (const p of packages) {
    if (p.manifest.name) {
      allPackages.set(p.manifest.name, p.manifest);
    }
  }

  test("all script chains exist and lifecycle scripts do not compile", () => {
    const allViolations: string[] = [];

    const rootViolations = checkScriptChains("root", root, allPackages);
    allViolations.push(...rootViolations);

    for (const p of packages) {
      const pkgViolations = checkScriptChains(p.manifest.name ?? p.dir, p.manifest, allPackages);
      allViolations.push(...pkgViolations);
    }

    expect(allViolations, `Script chain violations:\n${allViolations.join("\n")}`).toEqual([]);
  });
});
