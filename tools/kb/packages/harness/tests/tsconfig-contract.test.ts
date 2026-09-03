import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RUNTIME_PRESET_BY_SCOPE,
  SANCTIONED_TSCONFIG_DELTAS,
  SCOPE_ALLOWS,
} from "../src/constraints.ts";
import {
  PACKAGES_ROOT,
  WORKSPACE_ROOT,
  axisValues,
  gitWorkspaceFiles,
  readTsconfig,
  tagsOf,
  workspacePackages,
} from "../src/workspace.ts";

/**
 * Harness check 3: the tsconfig contract (spec 11 / plan D9 / wave g2b).
 *
 * Three files, three jobs, no overlap:
 *   - `tsconfig.base.json` is strictness only. It matches the DESIGN.md table
 *     bit-for-bit and carries no runtime or module-system key.
 *   - `tsconfig.bun.json` / `tsconfig.browser.json` are the runtime presets.
 *     They extend the base, redeclare nothing it owns, and the Effect language
 *     service plugin block is authored in exactly one of them.
 *   - a package tsconfig names its `include` and its preset, and declares a
 *     compiler option only when `SANCTIONED_TSCONFIG_DELTAS` says why.
 *
 * Red cases (g2b report §6): a preset redeclaring a base flag, a package
 * redeclaring a preset key, and a second copy of the Effect plugin block.
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

    if (flag && (status === "active" || status === "deferred" || status === "rejected")) {
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
function presetFor(dir: string): string | undefined {
  const pkg = workspacePackages().find((p) => p.dir === dir);
  if (!pkg) return undefined;
  const scope = axisValues(tagsOf(pkg.manifest), "scope")[0];
  return scope === undefined ? undefined : RUNTIME_PRESET_BY_SCOPE[scope];
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

  test("runtime presets extend the base and redeclare no base-owned key", () => {
    const baseKeys = new Set(Object.keys(baseOptions()));
    const violations: string[] = [];

    for (const [file, path] of Object.entries(presetPaths)) {
      const preset = readTsconfig(path);

      if (preset.extends !== "./tsconfig.base.json") {
        violations.push(
          `${file} extends '${String(preset.extends)}' (want './tsconfig.base.json')`,
        );
      }

      for (const [key, value] of Object.entries(preset.compilerOptions ?? {})) {
        if (baseKeys.has(key)) {
          violations.push(`${file} redeclares base compilerOptions.${key} = ${String(value)}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("the Effect language service plugin block is authored exactly once", () => {
    const authored = gitWorkspaceFiles(["*.json"]).filter((file) =>
      readFileSync(join(WORKSPACE_ROOT, file), "utf8").includes(EFFECT_PLUGIN),
    );
    expect(authored, `${EFFECT_PLUGIN} appears in: ${authored.join(", ")}`).toEqual([
      "tsconfig.bun.json",
    ]);
  });

  test("every package extends its scope's preset and declares only sanctioned deltas", () => {
    const baseKeys = new Set(Object.keys(baseOptions()));
    const presetKeys = new Map(
      Object.entries(presetPaths).map(([file, path]) => [
        file,
        new Set(Object.keys(readTsconfig(path).compilerOptions ?? {})),
      ]),
    );

    const bad: string[] = [];
    for (const { dir } of workspacePackages()) {
      const tsPath = join(PACKAGES_ROOT, dir, "tsconfig.json");
      if (!existsSync(tsPath)) {
        bad.push(`${dir}: no tsconfig.json`);
        continue;
      }

      const config = readTsconfig(tsPath);
      const preset = presetFor(dir);
      if (preset === undefined) {
        bad.push(`${dir}: no scope tag, so no preset can be derived`);
        continue;
      }

      const want = `../../${preset}`;
      if (config.extends !== want) {
        bad.push(`${dir}: extends '${String(config.extends)}' (want '${want}')`);
      }

      for (const key of Object.keys(config)) {
        if (!ALLOWED_PACKAGE_TOP_LEVEL.has(key)) {
          bad.push(`${dir}: unexpected top-level tsconfig key '${key}'`);
        }
      }

      const sanctioned = SANCTIONED_TSCONFIG_DELTAS[dir] ?? {};
      for (const [key, value] of Object.entries(config.compilerOptions ?? {})) {
        if (key in sanctioned) continue;
        if (baseKeys.has(key)) {
          bad.push(`${dir}: redeclares base compilerOptions.${key} = ${String(value)}`);
        } else if (presetKeys.get(preset)?.has(key) === true) {
          bad.push(`${dir}: redeclares ${preset} compilerOptions.${key} = ${String(value)}`);
        } else {
          bad.push(`${dir}: unsanctioned compilerOptions.${key} = ${String(value)}`);
        }
      }
    }

    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("every sanctioned delta is still declared by the package that claimed it", () => {
    const stale: string[] = [];
    for (const [dir, deltas] of Object.entries(SANCTIONED_TSCONFIG_DELTAS)) {
      const tsPath = join(PACKAGES_ROOT, dir, "tsconfig.json");
      const opts = existsSync(tsPath) ? (readTsconfig(tsPath).compilerOptions ?? {}) : {};
      for (const key of Object.keys(deltas)) {
        if (!(key in opts)) {
          stale.push(`${dir}: sanctioned delta '${key}' is no longer declared — drop the sanction`);
        }
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });
});
