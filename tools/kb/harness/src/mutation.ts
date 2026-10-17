/**
 * The mutation lane: how a run over `stryker.config.json`'s scope stays
 * inside a bounded job however large the scope grows (DESIGN.md → Testing
 * doctrine; docs/ci.md → kb-mutation). `bun run test:mutation` runs it
 * locally; `.github/workflows/kb-mutation.yml` runs the same steps, one shard
 * per job.
 *
 * Two facts shape it, both measured on this workspace:
 *
 *   - Stryker's command runner reports no per-test coverage, so every mutant
 *     runs the whole command. What a mutant costs is what its command costs.
 *   - A mutant is visible only to the tests of its own package. Stryker
 *     copies the workspace into a sandbox but links each package's
 *     `node_modules` back to the real one, so `@kb/model` imported from
 *     another package resolves to the unmutated source. A test outside the
 *     package costs time and can kill nothing.
 *
 * So a shard is some of one package's source files, run against that
 * package's `tests/`. The plan cuts each package into as many shards as its
 * cost needs: its mutants × the seconds its tests take ÷ the runner's
 * concurrency, at most `SHARD_BUDGET_SECONDS` each. A growing scope adds
 * shards; no shard grows past the budget, unless one file alone does.
 *
 * Every shard runs incrementally from one baseline, the merged report of the
 * last complete run. Stryker reuses the result of every mutant whose code did
 * not change. With no coverage it cannot tell that a changed test would now
 * kill a survivor, so a full run (`--full`: monthly in CI, and whenever there
 * is no baseline) is what catches up with the tests.
 */
import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { basename, dirname, join } from "node:path";
import { Instrumenter } from "@stryker-mutator/instrumenter";
import { calculateMetrics } from "mutation-testing-metrics";
import type { MutationTestResult } from "mutation-testing-report-schema";
import { WORKSPACE_ROOT, gitWorkspaceFiles, workspacePackages } from "./workspace.ts";

/** The longest a shard's mutants may take, by the plan's estimate: a margin under the job's 120 minutes. */
export const SHARD_BUDGET_SECONDS = 45 * 60;

const BASE_CONFIG = join(WORKSPACE_ROOT, "stryker.config.json");
const SHARD_DIR = "reports/mutation/shards";
/** The merged report of the last complete run, which every shard's incremental run starts from. */
const BASELINE = "reports/mutation/baseline.json";

/** What of `stryker.config.json` the lane reads; the rest passes through to every shard. */
export interface StrykerConfig {
  readonly mutate: readonly string[];
  readonly commandRunner: { readonly command: string };
  readonly htmlReporter: { readonly fileName: string };
  readonly mutator?: Record<string, unknown>;
  readonly [option: string]: unknown;
}

/** A Stryker run of its own: these files, against these tests. */
export interface MutationShard {
  readonly name: string;
  readonly mutate: readonly string[];
  readonly tests: string;
}

/** One package's part of the scope: its files with their mutants, and what its tests take. */
export interface PackageCost {
  /** Short name, `@kb/` dropped: names its shards. */
  readonly name: string;
  readonly tests: string;
  readonly mutants: ReadonlyMap<string, number>;
  readonly testSeconds: number;
}

export function readBaseConfig(): StrykerConfig {
  return JSON.parse(readFileSync(BASE_CONFIG, "utf8")) as StrykerConfig;
}

/** Test runners per shard: Stryker's own default, stated here so the plan and the run agree. */
export function runnerConcurrency(cores: number = availableParallelism()): number {
  return cores <= 4 ? cores : cores - 1;
}

/** The files `mutate` selects: tracked files matching a pattern and no `!` pattern. */
export function scopeFiles(mutate: readonly string[], candidates: readonly string[]): string[] {
  const include = mutate.filter((p) => !p.startsWith("!")).map((p) => new Bun.Glob(p));
  const exclude = mutate.filter((p) => p.startsWith("!")).map((p) => new Bun.Glob(p.slice(1)));
  return candidates.filter(
    (file) => include.some((g) => g.match(file)) && !exclude.some((g) => g.match(file)),
  );
}

/**
 * The shards a package's cost needs, its files dealt largest first onto the
 * lightest shard. One shard keeps the package's name; several are numbered.
 */
export function packageShards(
  cost: PackageCost,
  concurrency: number,
  budget = SHARD_BUDGET_SECONDS,
): MutationShard[] {
  const files = [...cost.mutants].toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const total = files.reduce((sum, [, n]) => sum + n, 0);
  const count = Math.max(
    1,
    Math.min(files.length, Math.ceil((total * cost.testSeconds) / (concurrency * budget))),
  );
  const bins = Array.from({ length: count }, () => ({ mutants: 0, files: [] as string[] }));
  // GAP [[01M558MRWHR92991GYFRC5WWXY]]: a file is dealt whole, so one that alone passes the budget is one shard that does.
  for (const [file, n] of files) {
    const lightest = bins.reduce((min, bin) => (bin.mutants < min.mutants ? bin : min));
    lightest.files.push(file);
    lightest.mutants += n;
  }
  return bins.map((bin, i) => ({
    name: count === 1 ? cost.name : `${cost.name}-${String(i + 1)}`,
    mutate: bin.files.toSorted(),
    tests: cost.tests,
  }));
}

/** The config a shard runs: the base, narrowed to its files and its package's tests, incremental. */
export function shardConfig(
  base: StrykerConfig,
  shard: MutationShard,
  options: { full: boolean; concurrency: number },
) {
  const { $schema: _schema, _comment: _note, ...rest } = base;
  return {
    ...rest,
    mutate: shard.mutate,
    commandRunner: {
      ...base.commandRunner,
      command: `${base.commandRunner.command} ${shard.tests}`,
    },
    concurrency: options.concurrency,
    incremental: true,
    incrementalFile: `${SHARD_DIR}/${shard.name}.json`,
    force: options.full,
    htmlReporter: { fileName: `${SHARD_DIR}/${shard.name}.html` },
  };
}

/** A shard's report, and the files it was run over: the only ones it answers for. */
export interface ShardReport {
  readonly mutate: readonly string[];
  readonly report: MutationTestResult;
}

/** The files of a shard's report it ran itself. */
function ownFiles({ mutate, report }: ShardReport) {
  return Object.entries(report.files).filter(([file]) => mutate.includes(file));
}

/**
 * One report from the shards' reports. Each file comes from the shard that
 * ran it: a shard's report also carries the baseline's copy of every other
 * shard's files, which this run may have re-tested since.
 */
export function mergeReports(shards: readonly ShardReport[]): MutationTestResult {
  const [first] = shards;
  if (first === undefined) throw new Error("no shard reports to merge");
  return {
    ...first.report,
    files: Object.fromEntries(shards.flatMap(ownFiles)),
    testFiles: Object.assign({}, ...shards.map(({ report }) => report.testFiles ?? {})),
  };
}

/** Killed and timed-out mutants over every valid one, in percent. */
export function mutationScore(report: MutationTestResult): number {
  return calculateMetrics(report.files).metrics.mutationScore;
}

/** The report as Stryker's own HTML reporter writes it: the report app with the report inlined. */
function reportHtml(report: MutationTestResult): string {
  const require = createRequire(import.meta.url);
  const app = readFileSync(
    require.resolve("mutation-testing-elements/dist/mutation-test-elements.js"),
    "utf8",
  );
  // A `<` only ever sits inside a JSON string, where `\u003c` reads the same
  // and cannot close the script element.
  const data = JSON.stringify(report).replaceAll("<", "\\u003c");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><script>${app}</script></head>
<body>
<mutation-test-report-app titlePostfix="kb"></mutation-test-report-app>
<script>document.querySelector("mutation-test-report-app").report = ${data};</script>
</body>
</html>
`;
}

const quiet = () => undefined;
/** The instrumenter's logger: counting mutants has nothing to say. */
const SILENT = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace: quiet,
  debug: quiet,
  info: quiet,
  warn: quiet,
  error: quiet,
  fatal: quiet,
};

async function countMutants(
  files: readonly string[],
  mutator: Record<string, unknown> = {},
): Promise<Map<string, number>> {
  const { mutants } = await new Instrumenter(SILENT).instrument(
    files.map((name) => ({
      name,
      content: readFileSync(join(WORKSPACE_ROOT, name), "utf8"),
      mutate: true,
    })),
    { plugins: null, excludedMutations: [], ignorers: [], ...mutator },
  );
  const counts = new Map(files.map((file) => [file, 0]));
  for (const mutant of mutants) counts.set(mutant.fileName, (counts.get(mutant.fileName) ?? 0) + 1);
  return counts;
}

/**
 * Seconds `command` takes with every runner busy: `copies` of it at once, as
 * a shard runs them. Timed alone it reads several times faster than a
 * mutant really costs, since the copies share the cores.
 */
async function timeCommand(command: string, copies: number): Promise<number> {
  const started = performance.now();
  const runs = Array.from({ length: copies }, () =>
    Bun.spawn(["sh", "-c", command], { cwd: WORKSPACE_ROOT, stdout: "ignore", stderr: "ignore" }),
  );
  const codes = await Promise.all(runs.map((run) => run.exited));
  if (codes.some((code) => code !== 0)) throw new Error(`the plan's timing run failed: ${command}`);
  return (performance.now() - started) / 1000;
}

/** Every package in the scope, priced: mutants counted by Stryker's instrumenter, tests timed under load. */
async function packageCosts(base: StrykerConfig, concurrency: number): Promise<PackageCost[]> {
  const files = scopeFiles(base.mutate, gitWorkspaceFiles(["*.ts", "*.tsx"]));
  const mutants = await countMutants(files, base.mutator);
  const costs: PackageCost[] = [];
  for (const pkg of workspacePackages()) {
    const own = files.filter((file) => file.startsWith(`packages/${pkg.dir}/`));
    if (own.length === 0) continue;
    // GAP [[01M557P6VBJE7PJXTEFHQN16RX]]: tests in another package that drive these files cannot see their mutants.
    const tests = `packages/${pkg.dir}/tests`;
    costs.push({
      name: pkg.name.replace(/^@kb\//, ""),
      tests,
      mutants: new Map(own.map((file) => [file, mutants.get(file) ?? 0])),
      testSeconds: await timeCommand(`${base.commandRunner.command} ${tests}`, concurrency),
    });
  }
  return costs;
}

export async function planShards(base: StrykerConfig = readBaseConfig()): Promise<MutationShard[]> {
  const concurrency = runnerConcurrency();
  return (await packageCosts(base, concurrency)).flatMap((cost) => {
    const shards = packageShards(cost, concurrency);
    const mutants = [...cost.mutants.values()].reduce((sum, n) => sum + n, 0);
    const minutes = (mutants * cost.testSeconds) / concurrency / 60;
    // stderr, so `plan`'s stdout stays the one JSON line the workflow reads.
    console.error(
      `${cost.name}: ${String(mutants)} mutants × ${cost.testSeconds.toFixed(1)}s ÷ ${String(concurrency)} runners ≈ ${minutes.toFixed(0)} min → ${String(shards.length)} shard(s)`,
    );
    return shards;
  });
}

/** Runs one shard from the baseline, leaving its report under `reports/mutation/shards/`. */
function runShard(
  shard: MutationShard,
  full: boolean,
  base: StrykerConfig = readBaseConfig(),
): void {
  const config = shardConfig(base, shard, { full, concurrency: runnerConcurrency() });
  const configPath = join(WORKSPACE_ROOT, SHARD_DIR, `${shard.name}.config.json`);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const baseline = join(WORKSPACE_ROOT, BASELINE);
  if (!full && existsSync(baseline))
    copyFileSync(baseline, join(WORKSPACE_ROOT, config.incrementalFile));
  execSync(`stryker run ${configPath}`, { cwd: WORKSPACE_ROOT, stdio: "inherit" });
}

/** Merges the shards' reports into the baseline and the HTML report, and prints the score. */
function mergeShards(base: StrykerConfig = readBaseConfig()): number {
  const dir = join(WORKSPACE_ROOT, SHARD_DIR);
  const read = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const shards = readdirSync(dir)
    .filter((name) => name.endsWith(".config.json"))
    .map((name) => {
      const config = read(name) as { mutate: string[]; incrementalFile: string };
      return {
        mutate: config.mutate,
        report: read(basename(config.incrementalFile)) as MutationTestResult,
      };
    });
  const merged = mergeReports(shards);
  writeFileSync(join(WORKSPACE_ROOT, BASELINE), JSON.stringify(merged));
  writeFileSync(join(WORKSPACE_ROOT, base.htmlReporter.fileName), reportHtml(merged));
  const score = mutationScore(merged);
  const line = `Mutation score: ${score.toFixed(2)}% over ${String(Object.keys(merged.files).length)} files (advisory, never a gate).`;
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined) writeFileSync(summary, `${line}\n`, { flag: "a" });
  return score;
}

async function main(args: readonly string[]): Promise<void> {
  const full = args.includes("--full") || process.env.KB_MUTATION_FULL === "true";
  const command = args.find((arg) => !arg.startsWith("--"));
  if (command === "plan") {
    console.log(JSON.stringify(await planShards()));
  } else if (command === "run") {
    const shard = process.env.KB_MUTATION_SHARD;
    if (shard === undefined)
      throw new Error("run needs KB_MUTATION_SHARD: one shard of `plan`'s output");
    runShard(JSON.parse(shard) as MutationShard, full);
  } else if (command === "merge") {
    mergeShards();
  } else if (command === undefined) {
    rmSync(join(WORKSPACE_ROOT, SHARD_DIR), { recursive: true, force: true });
    for (const shard of await planShards()) runShard(shard, full);
    mergeShards();
  } else {
    throw new Error(`unknown command ${command}: plan | run | merge, or none to do all three`);
  }
}

if (import.meta.main) await main(process.argv.slice(2));
