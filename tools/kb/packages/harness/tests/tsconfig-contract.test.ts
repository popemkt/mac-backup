import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_ROOT, WORKSPACE_ROOT, workspacePackages } from "../src/workspace.ts";

/**
 * Harness check 3: Compiler strictness contract (spec 11 / plan D9).
 *
 * Parses the `### Compiler strictness contract` markdown table live from
 * tools/kb/DESIGN.md. Asserts:
 *   1. `tsconfig.base.json` matches every active flag in the table.
 *   2. Rejected and deferred flags are absent from `tsconfig.base.json`.
 *   3. `tsconfig.base.json` carries no runtime or module keys (target, module,
 *      moduleResolution, lib, jsx, paths, types, include).
 *   4. Every package tsconfig extends `../../tsconfig.base.json` and does not
 *      redeclare any key owned by the base.
 *
 * Red case: flip a flag or add a forbidden key to tsconfig.base.json.
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
    if (flag === "flag") continue; // Header row

    const value = valStr === "true" ? true : valStr === "false" ? false : null;
    if (value === null) continue;

    if (flag && (status === "active" || status === "deferred" || status === "rejected")) {
      rows.push({ flag, value, status });
    }
  }
  return rows;
}

function readJsonc(path: string): Record<string, unknown> {
  const content = readFileSync(path, "utf8");
  const stripped = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(stripped) as Record<string, unknown>;
}

describe("tsconfig-contract", () => {
  const designPath = join(WORKSPACE_ROOT, "DESIGN.md");
  const basePath = join(WORKSPACE_ROOT, "tsconfig.base.json");

  test("DESIGN.md has a valid compiler strictness contract table", () => {
    expect(existsSync(designPath)).toBe(true);
    const doc = readFileSync(designPath, "utf8");
    const rows = parseStrictnessContract(doc);
    expect(rows.length).toBeGreaterThanOrEqual(15);

    const flags = new Set(rows.map((r) => r.flag));
    expect(flags.has("strict")).toBe(true);
    expect(flags.has("noImplicitOverride")).toBe(true);
    expect(flags.has("noUncheckedIndexedAccess")).toBe(true);
    expect(flags.has("noPropertyAccessFromIndexSignature")).toBe(true);
  });

  test("tsconfig.base.json matches the DESIGN.md strictness table exactly", () => {
    const doc = readFileSync(designPath, "utf8");
    const rows = parseStrictnessContract(doc);
    const base = readJsonc(basePath) as {
      compilerOptions?: Record<string, unknown>;
    };
    const opts = base.compilerOptions ?? {};

    const bad: string[] = [];

    for (const row of rows) {
      if (row.status === "active") {
        if (opts[row.flag] !== row.value) {
          bad.push(
            `tsconfig.base.json compilerOptions.${row.flag} = ${String(opts[row.flag])} (want ${String(row.value)})`,
          );
        }
      } else if (row.status === "rejected" || row.status === "deferred") {
        if (opts[row.flag] !== undefined) {
          bad.push(
            `tsconfig.base.json compilerOptions.${row.flag} is present with status ${row.status} (should be absent)`,
          );
        }
      }
    }

    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("tsconfig.base.json carries no runtime or module system keys", () => {
    const base = readJsonc(basePath) as {
      compilerOptions?: Record<string, unknown>;
      [key: string]: unknown;
    };
    const opts = base.compilerOptions ?? {};

    const violations: string[] = [];
    for (const key of FORBIDDEN_IN_BASE) {
      if (key in opts || key in base) {
        violations.push(`tsconfig.base.json must not set '${key}'`);
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("every package tsconfig extends base and redeclares no base-owned keys", () => {
    const base = readJsonc(basePath) as {
      compilerOptions?: Record<string, unknown>;
    };
    const baseKeys = new Set(Object.keys(base.compilerOptions ?? {}));

    const bad: string[] = [];
    for (const { dir } of workspacePackages()) {
      const tsPath = join(PACKAGES_ROOT, dir, "tsconfig.json");
      if (!existsSync(tsPath)) continue;

      const raw = readJsonc(tsPath) as {
        extends?: string;
        compilerOptions?: Record<string, unknown>;
      };

      if (!raw.extends || !raw.extends.includes("tsconfig.base.json")) {
        bad.push(`${dir}: tsconfig.json does not extend tsconfig.base.json`);
      }

      const pkgOpts = raw.compilerOptions ?? {};
      for (const key of Object.keys(pkgOpts)) {
        if (baseKeys.has(key)) {
          bad.push(`${dir}: redeclares base compilerOptions.${key} = ${String(pkgOpts[key])}`);
        }
      }
    }

    expect(bad, bad.join("\n")).toEqual([]);
  });
});
