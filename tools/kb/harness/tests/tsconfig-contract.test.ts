import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ISO_PRESET,
  RUNTIME_PRESET_BY_SCOPE,
  SANCTIONED_TSCONFIG_DELTAS,
  SCOPE_ALLOWS,
  TESTS_TSCONFIG,
  TEST_PRESET,
} from "../src/constraints.ts";
import {
  type WorkspacePackage,
  PACKAGES_ROOT,
  WORKSPACE_ROOT,
  axisValues,
  effectPluginConfig,
  gitWorkspaceFiles,
  readTsconfig,
  tagsOf,
  tsconfigChain,
  workspacePackages,
} from "../src/workspace.ts";
import { BASELINE_PATH, type BaselineLanes } from "../src/snapshot.ts";

/**
 * Harness check 3: the tsconfig contract (spec 11 / plan D9 / wave g2b).
 *
 * Three files, three jobs, no overlap:
 *   - `tsconfig.base.json` is strictness only. It matches the DESIGN.md table
 *     bit-for-bit and carries no runtime or module-system key.
 *   - `tsconfig.iso.json` / `tsconfig.bun.json` / `tsconfig.browser.json` are
 *     the runtime presets. Each reaches the base through its `extends` chain,
 *     none redeclares a key the base owns, and the Effect language service
 *     plugin block is authored in exactly one of them.
 *   - a package tsconfig names its `include` and its preset, and declares a
 *     compiler option only when `SANCTIONED_TSCONFIG_DELTAS` says why. A
 *     package may carry a second project for its `tests/`, and that one is
 *     always Bun — `bun test` is Bun whatever the code under test targets.
 *
 * Red cases (g2b report §6, plus wave 2026-09-06 w3): a preset redeclaring a
 * base flag, a package redeclaring a preset key, a second copy of the Effect
 * plugin block, and a `scope:shared` package on the Bun preset.
 */

const FORBIDDEN_IN_BASE = [
  "target",
  "module",
  "moduleResolution",
  "lib",
  "jsx",
  "paths",
  "types",
  "include",
] as const;

/** A package tsconfig says where its sources are and which preset it uses. */
const ALLOWED_PACKAGE_TOP_LEVEL = new Set(["extends", "include", "exclude", "compilerOptions"]);

const EFFECT_PLUGIN = "@effect/language-service";

interface ContractRow {
  flag: string;
  value: boolean;
  status: "active" | "deferred" | "rejected";
}

function parseStrictnessContract(markdown: string): ContractRow[] {
  const sectionStart = markdown.indexOf("### Compiler strictness contract");
  if (sectionStart === -1) {
    throw new Error("DESIGN.md has no '### Compiler strictness contract' section");
  }

  const section = markdown.slice(sectionStart);
  const rows: ContractRow[] = [];

  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || trimmed.includes("---")) continue;

    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length < 3) continue;
    const [flag, valStr, status] = cells;
    if (flag === "flag") continue;

    const value = valStr === "true" ? true : valStr === "false" ? false : null;
    if (value === null) continue;

    if (
      flag !== undefined &&
      flag !== "" &&
      (status === "active" || status === "deferred" || status === "rejected")
    ) {
      rows.push({ flag, value, status });
    }
  }
  return rows;
}

const designPath = join(WORKSPACE_ROOT, "DESIGN.md");
const basePath = join(WORKSPACE_ROOT, "tsconfig.base.json");
const presetPaths = Object.fromEntries(
  [...new Set(Object.values(RUNTIME_PRESET_BY_SCOPE))].map((file) => [
    file,
    join(WORKSPACE_ROOT, file),
  ]),
);

function baseOptions(): Record<string, unknown> {
  return readTsconfig(basePath).compilerOptions ?? {};
}

/** The preset a package must extend, derived from the scope tag it carries. */
function presetFor(pkg: WorkspacePackage): string | undefined {
  const scope = axisValues(tagsOf(pkg.manifest), "scope")[0];
  return scope === undefined ? undefined : RUNTIME_PRESET_BY_SCOPE[scope];
}

/**
 * How far a package tsconfig is from the presets: `packages/<layer>/<pkg>`,
 * so three levels. Derived from the package's own path rather than written
 * out, so the depth is stated where the tree is.
 */
function presetPrefix(pkg: WorkspacePackage): string {
  return "../".repeat(pkg.dir.split("/").length + 1);
}

describe("tsconfig-contract", () => {
  test("DESIGN.md has a valid compiler strictness contract table", () => {
    expect(existsSync(designPath)).toBe(true);
    const rows = parseStrictnessContract(readFileSync(designPath, "utf8"));
    expect(rows.length).toBeGreaterThanOrEqual(15);

    const flags = new Set(rows.map((r) => r.flag));
    expect(flags.has("strict")).toBe(true);
    expect(flags.has("noImplicitOverride")).toBe(true);
    expect(flags.has("noUncheckedIndexedAccess")).toBe(true);
    expect(flags.has("noPropertyAccessFromIndexSignature")).toBe(true);
  });

  test("tsconfig.base.json matches the DESIGN.md strictness table exactly", () => {
    const rows = parseStrictnessContract(readFileSync(designPath, "utf8"));
    const opts = baseOptions();
    const bad: string[] = [];

    for (const row of rows) {
      if (row.status === "active") {
        if (opts[row.flag] !== row.value) {
          bad.push(
            `tsconfig.base.json compilerOptions.${row.flag} = ${String(opts[row.flag])} (want ${String(row.value)})`,
          );
        }
      } else if (opts[row.flag] !== undefined) {
        bad.push(
          `tsconfig.base.json compilerOptions.${row.flag} is present with status ${row.status} (should be absent)`,
        );
      }
    }

    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("tsconfig.base.json carries no runtime or module system keys", () => {
    const base = readTsconfig(basePath);
    const opts = base.compilerOptions ?? {};

    const violations: string[] = [];
    for (const key of FORBIDDEN_IN_BASE) {
      if (key in opts || key in base) {
        violations.push(`tsconfig.base.json must not set '${key}'`);
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

/** Every option a preset settles, including the ones it inherits. */
function effectivePresetKeys(preset: string): Set<string> {
  const keys = new Set<string>();
  for (const file of tsconfigChain(preset)) {
    for (const key of Object.keys(readTsconfig(join(WORKSPACE_ROOT, file)).compilerOptions ?? {})) {
      keys.add(key);
    }
  }
  return keys;
}

describe("tsconfig-presets", () => {
  test("every scope has a runtime preset and every preset file exists", () => {
    const missing: string[] = [];
    for (const scope of Object.keys(SCOPE_ALLOWS)) {
      if (RUNTIME_PRESET_BY_SCOPE[scope] === undefined) {
        missing.push(`scope:${scope} has no entry in RUNTIME_PRESET_BY_SCOPE`);
      }
    }
    for (const [file, path] of Object.entries(presetPaths)) {
      if (!existsSync(path)) missing.push(`${file} does not exist`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  test("every runtime preset reaches the base and redeclares no base-owned key", () => {
    const baseKeys = new Set(Object.keys(baseOptions()));
    const violations: string[] = [];

    for (const [file, path] of Object.entries(presetPaths)) {
      const chain = tsconfigChain(file);
      if (!chain.includes("tsconfig.base.json")) {
        violations.push(`${file} extends chain ${chain.join(" -> ")} never reaches the base`);
      }

      for (const [key, value] of Object.entries(readTsconfig(path).compilerOptions ?? {})) {
        if (baseKeys.has(key)) {
          violations.push(`${file} redeclares base compilerOptions.${key} = ${String(value)}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("scope:shared compiles against a preset with no Bun and no DOM", () => {
    // Red case: point RUNTIME_PRESET_BY_SCOPE.shared back at tsconfig.bun.json.
    const iso = readTsconfig(join(WORKSPACE_ROOT, ISO_PRESET)).compilerOptions ?? {};
    expect(RUNTIME_PRESET_BY_SCOPE.shared).toBe(ISO_PRESET);
    expect(iso.types, "a shared package must not be handed a @types package").toEqual([]);
    expect(iso.lib, "the isomorphic lib is the language plus the worker globals").toEqual([
      "ESNext",
      "WebWorker",
    ]);
  });

  test("the Effect language service plugin block is authored exactly once", () => {
    const authored = gitWorkspaceFiles(["*.json"]).filter((file) =>
      readFileSync(join(WORKSPACE_ROOT, file), "utf8").includes(EFFECT_PLUGIN),
    );
    expect(authored, `${EFFECT_PLUGIN} appears in: ${authored.join(", ")}`).toEqual([ISO_PRESET]);
  });

  function checkProject(
    pkg: WorkspacePackage,
    tsconfig: string,
    preset: string,
    bad: string[],
  ): void {
    const { dir, name } = pkg;
    const config = readTsconfig(join(PACKAGES_ROOT, dir, tsconfig));
    const baseKeys = new Set(Object.keys(baseOptions()));

    // A nested project is one directory further from the presets than its
    // package's own config, and the prefix is derived, never written out.
    const depth = "../".repeat(tsconfig.split("/").length - 1);
    const want = `${depth}${presetPrefix(pkg)}${preset}`;
    if (config.extends !== want) {
      bad.push(`${dir}/${tsconfig}: extends '${String(config.extends)}' (want '${want}')`);
    }

    for (const key of Object.keys(config)) {
      if (!ALLOWED_PACKAGE_TOP_LEVEL.has(key)) {
        bad.push(`${dir}/${tsconfig}: unexpected top-level tsconfig key '${key}'`);
      }
    }

    const sanctioned = SANCTIONED_TSCONFIG_DELTAS[name] ?? {};
    const presetKeys = effectivePresetKeys(preset);
    for (const [key, value] of Object.entries(config.compilerOptions ?? {})) {
      if (key in sanctioned) continue;
      if (baseKeys.has(key)) {
        bad.push(`${dir}/${tsconfig}: redeclares base compilerOptions.${key} = ${String(value)}`);
      } else if (presetKeys.has(key)) {
        bad.push(
          `${dir}/${tsconfig}: redeclares ${preset} compilerOptions.${key} = ${String(value)}`,
        );
      } else {
        bad.push(`${dir}/${tsconfig}: unsanctioned compilerOptions.${key} = ${String(value)}`);
      }
    }
  }

  test("every package extends its scope's preset and declares only sanctioned deltas", () => {
    const bad: string[] = [];
    for (const pkg of workspacePackages()) {
      const { dir } = pkg;
      if (!existsSync(join(PACKAGES_ROOT, dir, "tsconfig.json"))) {
        bad.push(`${dir}: no tsconfig.json`);
        continue;
      }

      const preset = presetFor(pkg);
      if (preset === undefined) {
        bad.push(`${dir}: no scope tag, so no preset can be derived`);
        continue;
      }

      checkProject(pkg, "tsconfig.json", preset, bad);

      // A package may carry one extra project, for its `tests/`, and that one
      // is Bun whatever the package's own scope is. Its `include` is checked
      // by `typecheck-scope`, which is where "every file is in exactly one
      // project" lives; here it only has to be on the right preset.
      if (existsSync(join(PACKAGES_ROOT, dir, TESTS_TSCONFIG))) {
        checkProject(pkg, TESTS_TSCONFIG, TEST_PRESET, bad);
      }
    }

    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("a tests project exists exactly where the package preset is not Bun", () => {
    // Otherwise a shared package either cannot compile `bun:test` or is
    // quietly compiling its `src/` against Bun after all.
    const bad: string[] = [];
    for (const pkg of workspacePackages()) {
      const hasTestsDir = existsSync(join(PACKAGES_ROOT, pkg.dir, "tests"));
      const hasTestsProject = existsSync(join(PACKAGES_ROOT, pkg.dir, TESTS_TSCONFIG));
      const wants = presetFor(pkg) !== TEST_PRESET && hasTestsDir;
      if (wants && !hasTestsProject) bad.push(`${pkg.dir}: has tests/ but no ${TESTS_TSCONFIG}`);
      if (!wants && hasTestsProject) {
        bad.push(`${pkg.dir}: has ${TESTS_TSCONFIG} but its own preset is already Bun`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("every sanctioned delta is still declared by the package that claimed it", () => {
    const dirByName = new Map(workspacePackages().map((pkg) => [pkg.name, pkg.dir]));
    const stale: string[] = [];
    for (const [name, deltas] of Object.entries(SANCTIONED_TSCONFIG_DELTAS)) {
      const dir = dirByName.get(name);
      if (dir === undefined) {
        stale.push(`${name}: sanctioned but no such package — drop the sanction`);
        continue;
      }
      const tsPath = join(PACKAGES_ROOT, dir, "tsconfig.json");
      const opts = existsSync(tsPath) ? (readTsconfig(tsPath).compilerOptions ?? {}) : {};
      for (const key of Object.keys(deltas)) {
        if (!(key in opts)) {
          stale.push(
            `${name}: sanctioned delta '${key}' is no longer declared — drop the sanction`,
          );
        }
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });
});

/**
 * The Effect diagnostics have two lanes and a rule is in exactly one of them:
 * counted by the ratchet at `suggestion`, or promoted to `error`. Promotion
 * carries a file scope — the Effect-native preference group describes how kb's
 * production code is written, so it is an error under a package's `src/` and a
 * suggestion everywhere else — and that scope is stated once, in the plugin's
 * `overrides`, next to the severities it changes.
 *
 * The scope is one `include` and nothing else. The harness lives outside
 * `packages/`, so `packages/*\/*\/src/**\/*` already excludes it; an `exclude`
 * beside the include would be a second list to keep in sync.
 *
 * Red cases: promote a rule that is still in the ratchet ledger; relax a rule
 * in the override instead of promoting it; add a second `overrides` entry;
 * carve a path out of the promoted lane with an `exclude`.
 */
describe("effect-severity-lanes", () => {
  const plugin = effectPluginConfig();
  const [override] = plugin.overrides;

  test("the preference lane has exactly one file scope", () => {
    expect(plugin.overrides.length, "the Effect file scope is stated once").toBe(1);
    expect(override?.include).toEqual(["packages/*/*/src/**/*"]);
    expect(
      override?.exclude,
      "the include is the whole scope; a carve-out would be a second list",
    ).toBeUndefined();
  });

  test("an override only ever promotes a suggestion to an error", () => {
    const bad: string[] = [];
    for (const [rule, severity] of Object.entries(override?.options?.diagnosticSeverity ?? {})) {
      if (severity !== "error") {
        bad.push(`${rule}: override severity is '${severity}' (an override only promotes)`);
      }
      const base = plugin.diagnosticSeverity[rule];
      if (base !== "suggestion") {
        bad.push(`${rule}: base severity is '${String(base)}' (want 'suggestion')`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("an effect rule is counted by the ratchet or promoted, never both", () => {
    const ledger = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes;
    const counted = new Set(
      Object.keys(ledger.lanes.blocking)
        .filter((rule) => rule.startsWith("effect/"))
        .map((rule) => rule.slice("effect/".length)),
    );
    const promoted = new Set(Object.keys(override?.options?.diagnosticSeverity ?? {}));

    const bad: string[] = [];
    for (const rule of promoted) {
      if (counted.has(rule)) {
        bad.push(`effect/${rule} is promoted to error and still in the ratchet ledger`);
      }
    }
    for (const rule of counted) {
      const base = plugin.diagnosticSeverity[rule];
      if (base !== "suggestion") {
        bad.push(`effect/${rule} is in the ratchet ledger but its severity is '${String(base)}'`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
