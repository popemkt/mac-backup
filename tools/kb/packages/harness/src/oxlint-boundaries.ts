/**
 * Generates oxlint `eslint/no-restricted-imports` override blocks from the
 * layer and scope constraint matrix (plan Addendum / D11).
 *
 * Single source of truth: `packages/harness/src/constraints.ts` + each
 * package's `nx.tags`. This module derives the forbidden imports per package
 * and formats them as oxlint override rules so that editors give immediate
 * inline squiggles without requiring a second linter (ESLint).
 */
import { LAYER_ALLOWS, SCOPE_ALLOWS } from "./constraints.ts";
import { axisValues, tagsOf, workspacePackages, type WorkspacePackage } from "./workspace.ts";

export interface OxlintOverride {
  files: string[];
  rules: Record<string, unknown>;
}

export function generateBoundaryOverrides(
  pkgs: WorkspacePackage[] = workspacePackages(),
): OxlintOverride[] {
  const pkgByDir = new Map<string, { dir: string; name: string; layer: string; scope: string }>();

  for (const p of pkgs) {
    const tags = tagsOf(p.manifest);
    const layer = axisValues(tags, "layer")[0];
    const scope = axisValues(tags, "scope")[0];
    if (
      layer !== undefined &&
      layer !== "" &&
      scope !== undefined &&
      scope !== "" &&
      p.manifest.name !== undefined &&
      p.manifest.name !== ""
    ) {
      pkgByDir.set(p.dir, { dir: p.dir, name: p.manifest.name, layer, scope });
    }
  }

  const overrides: OxlintOverride[] = [];

  // 1. Isomorphism fence: scope:shared packages run in the browser too, so no runtime builtins
  const sharedFiles = [...pkgByDir.values()]
    .filter((p) => p.scope === "shared")
    .map((p) => `packages/${p.dir}/src/**`)
    .toSorted();

  if (sharedFiles.length > 0) {
    overrides.push({
      files: sharedFiles,
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                regex: "^(bun:|node:|@effect/platform-bun)",
                message:
                  "scope:shared packages are isomorphic; runtime access belongs in an infrastructure or app package.",
              },
            ],
          },
        ],
      },
    });
  }

  // 2. Cross-package boundary fences per package
  for (const p of [...pkgByDir.values()].toSorted((a, b) => a.dir.localeCompare(b.dir))) {
    if (p.layer === "tooling" || p.dir === "harness") continue;

    const allowedLayers = new Set(LAYER_ALLOWS[p.layer] ?? []);
    const allowedScopes = new Set(SCOPE_ALLOWS[p.scope] ?? []);

    const forbidden: string[] = [];
    for (const target of [...pkgByDir.values()].toSorted((a, b) => a.dir.localeCompare(b.dir))) {
      if (target.dir === p.dir) continue;
      const layerForbidden = !allowedLayers.has(target.layer);
      const scopeForbidden = !allowedScopes.has(target.scope);
      if (layerForbidden || scopeForbidden) {
        forbidden.push(target.name.replace("@kb/", ""));
      }
    }

    if (forbidden.length > 0) {
      const names = forbidden.toSorted().join("|");
      overrides.push({
        files: [`packages/${p.dir}/src/**`],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  regex: `^@kb/(${names})(/.*)?$`,
                  message: `Boundary violation: package @kb/${p.dir} (${p.layer}/${p.scope}) may not import forbidden target packages.`,
                },
              ],
            },
          ],
        },
      });
    }
  }

  return overrides;
}
