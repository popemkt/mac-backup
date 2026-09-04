/**
 * Generates the lint-warn-baseline.json ratchet ledger (plan A.9 #2 / spec 11).
 *
 * Captures all current warnings from:
 *   1. oxlint (type-aware, over the root `lint` script's own scopes)
 *   2. effect-tsgo diagnostics (across every typecheck project but @kb/ui)
 *
 * Groups warnings into two lanes:
 *   - `blocking`: Tier R rules that fail if counts rise, and must be promoted
 *     when count drops to 0.
 *   - `advisory`: Tier A rules (typescript/no-deprecated) that are reported
 *     but never block.
 *
 * Deterministic: sorted keys, no timestamps.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { typecheckProjectDirs } from "./scopes.ts";
import { HARNESS_ROOT, rootManifest, WORKSPACE_ROOT } from "./workspace.ts";

export const BASELINE_PATH = join(HARNESS_ROOT, "lint-warn-baseline.json");

const ADVISORY_RULES = new Set(["typescript/no-deprecated"]);

export interface BaselineLanes {
  lanes: {
    blocking: Record<string, number>;
    advisory: Record<string, number>;
  };
}

interface OxlintDiagnostic {
  severity?: string;
  code?: string;
}

export interface TsgoDiagnostic {
  severity?: string;
  name?: string;
  file?: string;
}

/** A file under some package's `src/`. */
const PACKAGE_SRC_FILE = /(?:^|\/)packages\/[^/]+\/src\//;

/**
 * Which `@effect/tsgo` diagnostics the ratchet counts (DESIGN.md, "Ratchet
 * scope"). Correctness-severity diagnostics count wherever they appear;
 * suggestion-severity ones (Effect-native preferences, emitted as `message`)
 * count only under a package's `src/`, because they describe how production
 * code should be written and a test callback is not that code.
 */
export function countsTowardRatchet(diagnostic: TsgoDiagnostic): boolean {
  if (diagnostic.name === undefined || diagnostic.name === "") return false;
  if (diagnostic.severity === "warning") return true;
  if (diagnostic.severity !== "message") return false;
  if (diagnostic.file === undefined) return false;
  return PACKAGE_SRC_FILE.test(diagnostic.file);
}

/** Group one project's tsgo diagnostics into `effect/<name>` ratchet counts. */
export function tsgoDiagnosticCounts(
  diagnostics: readonly TsgoDiagnostic[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of diagnostics) {
    if (!countsTowardRatchet(d)) continue;
    const rule = `effect/${String(d.name)}`;
    counts[rule] = (counts[rule] ?? 0) + 1;
  }
  return counts;
}

function normalizeRuleName(code: string): string {
  const m = /^([^()]+)\(([^()]+)\)$/.exec(code);
  if (m) {
    return `${m[1]}/${m[2]}`;
  }
  return code;
}

function stdoutOf(err: unknown): string {
  if (typeof err === "object" && err !== null && "stdout" in err) {
    const s = err.stdout;
    if (typeof s === "string") return s;
  }
  return "";
}

/**
 * The lint scope is authored once, in the root `lint` script — the same string
 * `lint-scope-coverage` proves covers every file. The ledger measures what the
 * gate lints, so it runs that script rather than restating its arguments.
 */
function oxlintCommand(): string {
  const lint = rootManifest().scripts?.lint;
  if (lint === undefined || lint === "") {
    throw new Error("root package.json has no scripts.lint to derive the ledger's scope from");
  }
  return `node_modules/.bin/${lint} --format json`;
}

function collectOxlintWarnings(root: string, counts: Record<string, number>): void {
  let oxlintOut = "";
  try {
    oxlintOut = execSync(oxlintCommand(), {
      cwd: root,
      maxBuffer: 50 * 1024 * 1024,
      encoding: "utf8",
    });
  } catch (err: unknown) {
    oxlintOut = stdoutOf(err);
  }

  if (oxlintOut.length === 0) return;
  try {
    const parsed = JSON.parse(oxlintOut) as { diagnostics?: OxlintDiagnostic[] };
    for (const d of parsed.diagnostics ?? []) {
      if (d.severity === "warning" && d.code !== undefined && d.code !== "") {
        const code = normalizeRuleName(d.code);
        counts[code] = (counts[code] ?? 0) + 1;
      }
    }
  } catch {
    // ignore JSON parse errors
  }
}

function collectTsgoWarnings(root: string, counts: Record<string, number>): void {
  for (const dir of typecheckProjectDirs()) {
    if (dir === "packages/ui") continue;
    let tsgoOut = "";
    try {
      tsgoOut = execSync(
        `node_modules/.bin/effect-tsgo diagnostics --project ${dir}/tsconfig.json --format json`,
        {
          cwd: root,
          encoding: "utf8",
        },
      );
    } catch (err: unknown) {
      tsgoOut = stdoutOf(err);
    }

    if (tsgoOut.length === 0) continue;
    try {
      const parsed = JSON.parse(tsgoOut) as { diagnostics?: TsgoDiagnostic[] };
      for (const [rule, n] of Object.entries(tsgoDiagnosticCounts(parsed.diagnostics ?? []))) {
        counts[rule] = (counts[rule] ?? 0) + n;
      }
    } catch {
      // ignore parse error
    }
  }
}

export function collectLinterWarnings(root: string = WORKSPACE_ROOT): Record<string, number> {
  const counts: Record<string, number> = {};
  collectOxlintWarnings(root, counts);
  collectTsgoWarnings(root, counts);
  return counts;
}

function buildBaseline(counts: Record<string, number>): BaselineLanes {
  const blocking: Record<string, number> = {};
  const advisory: Record<string, number> = {};

  const sortedRules = Object.keys(counts).toSorted();
  for (const rule of sortedRules) {
    const count = counts[rule];
    if (count === undefined) continue;
    if (ADVISORY_RULES.has(rule)) {
      advisory[rule] = count;
    } else {
      blocking[rule] = count;
    }
  }

  return {
    lanes: {
      blocking,
      advisory,
    },
  };
}

if (import.meta.main) {
  console.log("Collecting warnings across oxlint and effect-tsgo...");
  const counts = collectLinterWarnings();
  const baseline = buildBaseline(counts);
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(
    `Wrote baseline to ${BASELINE_PATH}: ${Object.keys(baseline.lanes.blocking).length} blocking rules, ${Object.keys(baseline.lanes.advisory).length} advisory rules.`,
  );
}
