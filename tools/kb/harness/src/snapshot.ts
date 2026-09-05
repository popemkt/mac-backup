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
import { RUNTIME_PRESET_BY_SCOPE } from "./constraints.ts";
import { projectDirOf, typecheckProjects } from "./scopes.ts";
import {
  HARNESS_ROOT,
  WORKSPACE_ROOT,
  axisValues,
  hasEffectDiagnostics,
  rootManifest,
  tagsOf,
  workspacePackages,
} from "./workspace.ts";

export const BASELINE_PATH = join(HARNESS_ROOT, "lint-warn-baseline.json");

const ADVISORY_RULES = new Set(["typescript/no-deprecated"]);

export interface BaselineLanes {
  lanes: {
    blocking: Record<string, number>;
    advisory: Record<string, number>;
    knip: Record<string, number>;
  };
}

export interface CollectorResult {
  ok: boolean;
  findings: Record<string, number>;
}

export type CommandRunner = (
  command: string,
  options: { cwd: string; encoding: "utf8"; maxBuffer?: number },
) => string;

interface OxlintDiagnostic {
  severity?: string;
  code?: string;
}

export interface TsgoDiagnostic {
  severity?: string;
  name?: string;
  file?: string;
}

interface KnipNamedFinding {
  name: string;
  namespace?: string;
}

interface KnipIssue {
  file: string;
  dependencies: KnipNamedFinding[];
  devDependencies: KnipNamedFinding[];
  optionalPeerDependencies: KnipNamedFinding[];
  exports: KnipNamedFinding[];
  types: KnipNamedFinding[];
  nsExports: KnipNamedFinding[];
  nsTypes: KnipNamedFinding[];
  duplicates: KnipNamedFinding[][];
  files: Array<string | KnipNamedFinding>;
}

/** A file under some package's `src/`, i.e. `packages/<layer>/<package>/src/`. */
const PACKAGE_SRC_FILE = /(?:^|\/)packages\/[^/]+\/[^/]+\/src\//;

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

const defaultRunner: CommandRunner = (command, options) => execSync(command, options);

function commandOutput(
  command: string,
  root: string,
  run: CommandRunner,
  maxBuffer?: number,
): string {
  try {
    return run(command, {
      cwd: root,
      encoding: "utf8",
      ...(maxBuffer === undefined ? {} : { maxBuffer }),
    });
  } catch (err: unknown) {
    return stdoutOf(err);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOxlintDiagnostic(value: unknown): value is OxlintDiagnostic {
  return isRecord(value) && optionalString(value.severity) && optionalString(value.code);
}

function isTsgoDiagnostic(value: unknown): value is TsgoDiagnostic {
  return (
    isRecord(value) &&
    optionalString(value.severity) &&
    optionalString(value.name) &&
    optionalString(value.file)
  );
}

function decodeDiagnostics<T>(
  output: string,
  isDiagnostic: (value: unknown) => value is T,
): readonly T[] | undefined {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!isRecord(parsed) || !Array.isArray(parsed.diagnostics)) return undefined;
    if (!parsed.diagnostics.every(isDiagnostic)) return undefined;
    return parsed.diagnostics;
  } catch {
    return undefined;
  }
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

export function collectOxlintWarnings(
  root: string = WORKSPACE_ROOT,
  run: CommandRunner = defaultRunner,
): CollectorResult {
  const output = commandOutput(oxlintCommand(), root, run, 50 * 1024 * 1024);
  const diagnostics = decodeDiagnostics(output, isOxlintDiagnostic);
  if (diagnostics === undefined) return { ok: false, findings: {} };

  const findings: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.severity === "warning" &&
      diagnostic.code !== undefined &&
      diagnostic.code !== ""
    ) {
      const code = normalizeRuleName(diagnostic.code);
      findings[code] = (findings[code] ?? 0) + 1;
    }
  }
  return { ok: true, findings };
}

/**
 * Typecheck projects `effect-tsgo` has nothing to say about. The
 * `@effect/language-service` block is authored in one preset alone, so a
 * project whose `extends` chain never reaches it emits no Effect diagnostic —
 * asking costs a whole `tsc` run for an empty answer. Walked rather than
 * compared, because the Bun preset inherits the block from the isomorphic one.
 */
function nonEffectProjectDirs(): Set<string> {
  return new Set(
    workspacePackages()
      .filter((pkg) => {
        const scope = axisValues(tagsOf(pkg.manifest), "scope")[0];
        const preset = scope === undefined ? undefined : RUNTIME_PRESET_BY_SCOPE[scope];
        return preset === undefined || !hasEffectDiagnostics(preset);
      })
      .map(projectDirOf),
  );
}

export function collectTsgoWarnings(
  root: string = WORKSPACE_ROOT,
  run: CommandRunner = defaultRunner,
): CollectorResult {
  const findings: Record<string, number> = {};
  let ok = true;
  const skip = nonEffectProjectDirs();
  for (const project of typecheckProjects()) {
    if (skip.has(project.owner)) continue;
    const output = commandOutput(
      `node_modules/.bin/effect-tsgo diagnostics --project ${project.file} --format json`,
      root,
      run,
    );
    const diagnostics = decodeDiagnostics(output, isTsgoDiagnostic);
    if (diagnostics === undefined) {
      ok = false;
      continue;
    }
    for (const [rule, count] of Object.entries(tsgoDiagnosticCounts(diagnostics))) {
      findings[rule] = (findings[rule] ?? 0) + count;
    }
  }
  return { ok, findings };
}

export function collectLinterWarnings(
  root: string = WORKSPACE_ROOT,
  run: CommandRunner = defaultRunner,
): CollectorResult {
  const oxlint = collectOxlintWarnings(root, run);
  const tsgo = collectTsgoWarnings(root, run);
  const findings = { ...oxlint.findings };
  for (const [rule, count] of Object.entries(tsgo.findings)) {
    findings[rule] = (findings[rule] ?? 0) + count;
  }
  return { ok: oxlint.ok && tsgo.ok, findings };
}

function knipCommand(): string {
  const knip = rootManifest().scripts?.knip;
  if (knip === undefined || knip === "") {
    throw new Error("root package.json has no scripts.knip to derive the ledger's scope from");
  }
  return `node_modules/.bin/${knip} --reporter json --no-config-hints --no-tag-hints`;
}

function isNamedFinding(value: unknown): value is KnipNamedFinding {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name !== "" &&
    optionalString(value.namespace)
  );
}

const KNIP_NAMED_CATEGORIES = [
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "exports",
  "types",
  "nsExports",
  "nsTypes",
] as const;

function isKnipIssue(value: unknown): value is KnipIssue {
  if (!isRecord(value) || typeof value.file !== "string" || value.file === "") return false;
  for (const category of KNIP_NAMED_CATEGORIES) {
    const entries = value[category];
    if (!Array.isArray(entries) || !entries.every(isNamedFinding)) return false;
  }
  if (
    !Array.isArray(value.duplicates) ||
    !value.duplicates.every(
      (group) => Array.isArray(group) && group.length > 0 && group.every(isNamedFinding),
    )
  ) {
    return false;
  }
  return (
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === "string" || isNamedFinding(file))
  );
}

function namedIdentity(finding: KnipNamedFinding): string {
  return finding.namespace === undefined ? finding.name : `${finding.namespace}.${finding.name}`;
}

function incrementFinding(findings: Record<string, number>, identity: string): void {
  findings[identity] = (findings[identity] ?? 0) + 1;
}

export function collectKnipFindings(
  root: string = WORKSPACE_ROOT,
  run: CommandRunner = defaultRunner,
): CollectorResult {
  const output = commandOutput(knipCommand(), root, run, 50 * 1024 * 1024);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { ok: false, findings: {} };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.issues) || !parsed.issues.every(isKnipIssue)) {
    return { ok: false, findings: {} };
  }

  const findings: Record<string, number> = {};
  for (const issue of parsed.issues) {
    for (const category of KNIP_NAMED_CATEGORIES) {
      for (const finding of issue[category]) {
        incrementFinding(findings, `${category}:${issue.file}:${namedIdentity(finding)}`);
      }
    }
    for (const group of issue.duplicates) {
      const names = group.map(namedIdentity).toSorted().join("|");
      incrementFinding(findings, `duplicates:${issue.file}:${names}`);
    }
    for (const file of issue.files) {
      const name = typeof file === "string" ? file : namedIdentity(file);
      incrementFinding(findings, `files:${issue.file}:${name}`);
    }
  }
  return { ok: true, findings };
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));
}

function buildBaseline(
  counts: Record<string, number>,
  knipFindings: Record<string, number>,
): BaselineLanes {
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
      knip: sortedRecord(knipFindings),
    },
  };
}

if (import.meta.main) {
  console.log("Collecting warnings across oxlint, effect-tsgo, and Knip...");
  const lint = collectLinterWarnings();
  const knip = collectKnipFindings();
  if (!lint.ok || !knip.ok) {
    throw new Error("collector execution or JSON decoding failed; baseline was not written");
  }
  const baseline = buildBaseline(lint.findings, knip.findings);
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(
    `Wrote baseline to ${BASELINE_PATH}: ${Object.keys(baseline.lanes.blocking).length} blocking rules, ${Object.keys(baseline.lanes.advisory).length} advisory rules, ${Object.keys(baseline.lanes.knip).length} Knip identities.`,
  );
}
