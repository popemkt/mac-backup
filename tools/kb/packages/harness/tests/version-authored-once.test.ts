import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OFF_CATALOG_BY_DECISION } from "../src/constraints.ts";
import {
  WORKSPACE_ROOT,
  dependencyEntries,
  rootManifest,
  workspacePackages,
} from "../src/workspace.ts";

/**
 * Every version is authored in exactly one place (plan D1).
 *
 * Internal deps say `workspace:*`, external deps say `catalog:`, and the
 * catalog in the root manifest is the only file that names a version. The
 * exceptions live in OFF_CATALOG_BY_DECISION with the reason attached, so an
 * exception is a decision rather than a slip.
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
        if (OFF_CATALOG_BY_DECISION[name] === spec) continue;
        bad.push(`${dir} ${field}.${name} = ${spec} (want catalog:)`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("the root manifest only uses catalog: or a recorded exception", () => {
    const bad: string[] = [];
    for (const [field, name, spec] of dependencyEntries(root)) {
      if (spec === "catalog:") continue;
      if (OFF_CATALOG_BY_DECISION[name] === spec) continue;
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
    const missing = [...used].filter((n) => !(n in catalog)).sort();
    const unused = Object.keys(catalog)
      .filter((n) => !used.has(n))
      .sort();
    expect(missing, `catalog: with no catalog entry: ${missing.join(", ")}`).toEqual([]);
    expect(unused, `catalog entry nobody asks for: ${unused.join(", ")}`).toEqual([]);
  });

  test("no catalog entry floats", () => {
    const floating = Object.entries(catalog)
      .filter(([, spec]) => FLOATING.has(spec.trim()))
      .map(([name, spec]) => `${name} = ${spec}`);
    expect(floating, floating.join("\n")).toEqual([]);
  });

  test("bunfig sets minimumReleaseAge and an explicit trustedDependencies", () => {
    const bunfig = readFileSync(join(WORKSPACE_ROOT, "bunfig.toml"), "utf8");
    const age = /^\s*minimumReleaseAge\s*=\s*(\d+)\s*$/m.exec(bunfig);
    expect(age, "bunfig.toml [install] has no minimumReleaseAge").not.toBeNull();
    expect(Number(age?.[1])).toBeGreaterThanOrEqual(MIN_RELEASE_AGE_MINUTES);
    expect(
      /^\s*trustedDependencies\s*=\s*\[/m.test(bunfig),
      "bunfig.toml [install] has no explicit trustedDependencies allowlist",
    ).toBe(true);
  });
});
