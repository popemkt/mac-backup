import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MutationTestResult } from "mutation-testing-report-schema";
import {
  SHARD_BUDGET_SECONDS,
  mergeReports,
  mutationScore,
  packageShards,
  readBaseConfig,
  runnerConcurrency,
  scopeFiles,
  shardConfig,
  type PackageCost,
} from "../src/mutation.ts";
import { WORKSPACE_ROOT, gitWorkspaceFiles } from "../src/workspace.ts";

/**
 * The mutation lane's plan (`harness/src/mutation.ts`): a shard never costs
 * more than the budget unless one file alone does, a shard runs only its own
 * package's tests, and the shards' reports merge back into one, each file
 * from the shard that ran it.
 *
 * Red cases: let `packageShards` return one shard per package; build a
 * shard's command from the base command alone; merge every file each report carries.
 */

const cost = (mutants: Record<string, number>, testSeconds: number): PackageCost => ({
  name: "model",
  tests: "packages/domain/model/tests",
  mutants: new Map(Object.entries(mutants)),
  testSeconds,
});

/** A shard's estimated minutes under a cost: its mutants × the tests' seconds ÷ the runners. */
const minutesOf = (files: readonly string[], c: PackageCost, runners: number) =>
  (files.reduce((sum, f) => sum + (c.mutants.get(f) ?? 0), 0) * c.testSeconds) / runners / 60;

const result = (files: MutationTestResult["files"]): MutationTestResult => ({
  schemaVersion: "2",
  thresholds: { high: 80, low: 60 },
  files,
});

/** One mutant at the top of a one-line file. */
const mutant = (id: string, status: "Killed" | "Survived") => ({
  id,
  mutatorName: "BooleanLiteral",
  replacement: "false",
  status,
  location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
});

describe("mutation-lane", () => {
  test("a package that fits the budget is one shard, named for its package", () => {
    const shards = packageShards(cost({ "a.ts": 10, "b.ts": 20 }, 1), 3);
    expect(shards).toEqual([
      { name: "model", mutate: ["a.ts", "b.ts"], tests: "packages/domain/model/tests" },
    ]);
  });

  test("a package past the budget splits into shards that each fit it", () => {
    const files = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`f${String(i)}.ts`, 100 + i * 10]),
    );
    const c = cost(files, 6);
    const shards = packageShards(c, 3);
    expect(shards.length).toBeGreaterThan(1);
    expect(shards.map((s) => s.name)).toEqual(shards.map((_, i) => `model-${String(i + 1)}`));
    expect(shards.flatMap((s) => s.mutate).toSorted()).toEqual(Object.keys(files).toSorted());
    for (const shard of shards) {
      expect(minutesOf(shard.mutate, c, 3)).toBeLessThanOrEqual((SHARD_BUDGET_SECONDS / 60) * 1.1);
      expect(shard.tests).toBe(c.tests);
    }
  });

  test("more runners need fewer shards", () => {
    const c = cost(
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${String(i)}.ts`, 400])),
      6,
    );
    expect(packageShards(c, 9).length).toBeLessThan(packageShards(c, 3).length);
  });

  test("a shard is never empty, even when the cost asks for more shards than files", () => {
    const shards = packageShards(cost({ "huge.ts": 100_000 }, 10), 1);
    expect(shards).toHaveLength(1);
  });

  test("the runners are Stryker's default: every core up to four, one spare beyond", () => {
    expect([1, 3, 4, 5, 10].map((n) => runnerConcurrency(n))).toEqual([1, 3, 4, 4, 9]);
  });

  test("the scope is the tracked files the base config selects", () => {
    const base = readBaseConfig();
    const files = scopeFiles(base.mutate, gitWorkspaceFiles(["*.ts", "*.tsx"]));
    expect(files).toContain("packages/domain/model/src/merge.ts");
    expect(files.some((f) => f.endsWith(".d.ts"))).toBe(false);
    expect(
      scopeFiles(["src/**/*.ts", "!src/**/*.d.ts"], ["src/a.ts", "src/b.d.ts", "lib/c.ts"]),
    ).toEqual(["src/a.ts"]);
  });

  test("every package in the scope has the tests its shards run", () => {
    const base = readBaseConfig();
    const packages = new Set(
      scopeFiles(base.mutate, gitWorkspaceFiles(["*.ts"])).map((f) => f.split("/src/")[0] ?? f),
    );
    for (const dir of packages) expect(existsSync(join(WORKSPACE_ROOT, dir, "tests"))).toBe(true);
  });

  test("a shard runs the base's command over its own package's tests, from the shared baseline", () => {
    const base = readBaseConfig();
    const shard = {
      name: "query",
      mutate: ["packages/domain/query/src/queries.ts"],
      tests: "packages/domain/query/tests",
    };
    const config = shardConfig(base, shard, { full: false, concurrency: 3 });
    expect(config.commandRunner.command).toBe(
      `${base.commandRunner.command} packages/domain/query/tests`,
    );
    expect(config.mutate).toEqual(shard.mutate);
    expect(config.incremental).toBe(true);
    expect(config.force).toBe(false);
    expect(config.incrementalFile).toBe("reports/mutation/shards/query.json");
    expect(shardConfig(base, shard, { full: true, concurrency: 3 }).force).toBe(true);
    expect("$schema" in config).toBe(false);
  });

  test("the merged report takes each file from the shard that ran it, and scores them all", () => {
    const fresh = result({
      "a.ts": { language: "typescript", source: "true", mutants: [mutant("1", "Killed")] },
    });
    // b's report carries the baseline's stale copy of a.ts, where its mutant survived.
    const carried = result({
      "a.ts": { language: "typescript", source: "true", mutants: [mutant("1", "Survived")] },
      "b.ts": { language: "typescript", source: "true", mutants: [mutant("2", "Survived")] },
    });
    const merged = mergeReports([
      { mutate: ["a.ts"], report: fresh },
      { mutate: ["b.ts"], report: carried },
    ]);
    expect(Object.keys(merged.files)).toEqual(["a.ts", "b.ts"]);
    expect(merged.files["a.ts"]?.mutants[0]?.status).toBe("Killed");
    expect(mutationScore(merged)).toBe(50);
    expect(() => mergeReports([])).toThrow();
  });
});
