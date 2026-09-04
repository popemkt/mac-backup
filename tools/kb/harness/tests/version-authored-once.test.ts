import { describe, expect, test } from "bun:test";
import {
  bunfigInstall,
  dependencyEntries,
  rootManifest,
  workspacePackages,
} from "../src/workspace.ts";

/**
 * Every version is authored in exactly one place (plan D1).
 *
 * Internal deps say `workspace:*`, external deps say `catalog:`, and the
 * catalog in the root manifest is the only file that names a version, with
 * no exceptions.
 * Red case (demonstrated in the w1 report): add `"zod": "^4"` to a package.
 */
const MIN_RELEASE_AGE_MINUTES = 4320;
const FLOATING = new Set(["latest", "*", "next", "", "^", "~"]);

describe("version-authored-once", () => {
  const root = rootManifest();
  const catalog = root.workspaces?.catalog ?? {};

  test("no package manifest names a version", () => {
    const bad: string[] = [];
    for (const { dir, manifest } of workspacePackages()) {
      for (const [field, name, spec] of dependencyEntries(manifest)) {
        if (name.startsWith("@kb/")) {
          if (spec !== "workspace:*") {
            bad.push(`${dir} ${field}.${name} = ${spec} (want workspace:*)`);
          }
          continue;
        }
        if (spec === "catalog:") continue;
        bad.push(`${dir} ${field}.${name} = ${spec} (want catalog:)`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("the root manifest only uses catalog:", () => {
    const bad: string[] = [];
    for (const [field, name, spec] of dependencyEntries(root)) {
      if (spec === "catalog:") continue;
      bad.push(`root ${field}.${name} = ${spec}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("every catalog entry is used and no used name is missing", () => {
    const used = new Set<string>();
    for (const manifest of [root, ...workspacePackages().map((p) => p.manifest)]) {
      for (const [, name, spec] of dependencyEntries(manifest)) {
        if (spec === "catalog:") used.add(name);
      }
    }
    const missing = [...used].filter((n) => !(n in catalog)).toSorted();
    const unused = Object.keys(catalog)
      .filter((n) => !used.has(n))
      .toSorted();
    expect(missing, `catalog: with no catalog entry: ${missing.join(", ")}`).toEqual([]);
    expect(unused, `catalog entry nobody asks for: ${unused.join(", ")}`).toEqual([]);
  });

  test("no catalog entry floats", () => {
    const floating = Object.entries(catalog)
      .filter(([, spec]) => FLOATING.has(spec.trim()))
      .map(([name, spec]) => `${name} = ${spec}`);
    expect(floating, floating.join("\n")).toEqual([]);
  });

  /**
   * The vite alias pins the same version as vite-plus.
   * Red case: bump one of the two in the catalog without bumping the other.
   */
  test("the vite alias pins the same version as vite-plus", () => {
    const viteSpec = catalog.vite;
    const vitePlusSpec = catalog["vite-plus"];
    expect(typeof viteSpec).toBe("string");
    expect(typeof vitePlusSpec).toBe("string");
    if (typeof viteSpec !== "string" || typeof vitePlusSpec !== "string") {
      throw new Error("catalog.vite or catalog['vite-plus'] is not a string");
    }
    const match = /^npm:@voidzero-dev\/vite-plus-core@(.+)$/.exec(viteSpec);
    expect(
      match,
      `catalog.vite (${viteSpec}) is not an npm:@voidzero-dev/vite-plus-core@<version> alias`,
    ).not.toBeNull();
    expect(match?.[1]).toBe(vitePlusSpec);
  });

  test("bunfig sets minimumReleaseAge and an explicit trustedDependencies", () => {
    const install = bunfigInstall();
    expect(
      install.minimumReleaseAge,
      "bunfig.toml [install] has no minimumReleaseAge",
    ).toBeGreaterThanOrEqual(MIN_RELEASE_AGE_MINUTES);
    expect(
      Array.isArray(install.trustedDependencies),
      "bunfig.toml [install] has no explicit trustedDependencies allowlist",
    ).toBe(true);
  });
});
