/**
 * Generates the lint-warn-baseline.json ratchet ledger (plan A.9 #2 / spec 11).
 *
 * Captures all current warnings from:
 *   1. oxlint (type-aware over workspace packages)
 *   2. effect-tsgo diagnostics (across backend packages)
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
import { WORKSPACE_ROOT, workspacePackages } from "./workspace.ts";

export const BASELINE_PATH = join(WORKSPACE_ROOT, "packages", "harness", "lint-warn-baseline.json");

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

interface TsgoDiagnostic {
  severity?: string;
  name?: string;
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

function collectOxlintWarnings(root: string, counts: Record<string, number>): void {
  let oxlintOut = "";
  try {
    oxlintOut = execSync(
      "node_modules/.bin/oxlint --config .oxlintrc.json --type-aware packages --format json",
      {
        cwd: root,
        maxBuffer: 50 * 1024 * 1024,
        encoding: "utf8",
      },
    );
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
  const pkgs = workspacePackages();
  for (const { dir } of pkgs) {
    if (dir === "ui") continue;
    let tsgoOut = "";
    try {
      tsgoOut = execSync(
        `node_modules/.bin/effect-tsgo diagnostics --project packages/${dir}/tsconfig.json --format json`,
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
      for (const d of parsed.diagnostics ?? []) {
        if (d.severity === "warning" || d.severity === "message") {
          if (d.name !== undefined && d.name !== "") {
            const rule = `effect/${d.name}`;
            counts[rule] = (counts[rule] ?? 0) + 1;
          }
        }
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
