/**
 * The 50k-node store benchmark, in port terms, run against any adapter.
 *
 * It prints a table and asserts nothing: measured gates belong to Phase 4, and
 * a benchmark that fails the build on a slow laptop teaches people to skip it.
 * Its phases are the ones a session actually pays — first write, cold load,
 * datom build, one query, a `kb set`-shaped commit, an interactive edit — so
 * two adapters produce two columns of the same table rather than two tables.
 *
 * It lives here for the same reason {@link storeContract} does: what is being
 * measured is the port, not a backend's private pipeline.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffectStore } from "@kb/contracts";
import { SYSTEM_IDS, systemSeedNodes, type KbNode } from "@kb/model";
import { DatascriptIndex } from "@kb/query";
import { writeOut } from "@kb/runtime";
import type { StoreFactory } from "./store-contract.ts";

const N = 50_000;
const TAG_ID = "01BENCHTAG0000000000000001";
/** Fixed stamps: the fixture is about size, and a clock read here would be a
 * second source of time outside the determinism seam for no benefit. */
const AT = "2026-01-01T00:00:00.000Z";
const EDITED_AT = "2026-01-01T00:00:01.000Z";

/** Only when this file was named on the command line — never in a normal run. */
const benchmarkEnabled = Bun.argv.some((arg) => arg.endsWith("benchmark.test.ts"));

function elapsedSince(start: number): number {
  return performance.now() - start;
}

function printTable(name: string, rows: ReadonlyArray<readonly [string, number]>): void {
  // `writeOut` is the repo's one process-output seam; `console.*` stays off in
  // backend packages, benchmark tables included.
  writeOut(`| ${name} phase | ms |`);
  writeOut("|---|---:|");
  for (const [phase, ms] of rows) writeOut(`| ${phase} | ${ms.toFixed(1)} |`);
}

function benchmarkNodes(at: string): KbNode[] {
  const nodes: KbNode[] = systemSeedNodes(at);
  nodes.push({
    id: TAG_ID,
    text: "bench",
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    children: [],
    createdAt: at,
    updatedAt: at,
  });
  for (let i = 0; i < N; i++) {
    nodes.push({
      id: `01BENCH${String(i).padStart(20, "0")}`,
      text: `node ${i}`,
      props: i % 10 === 0 ? { [SYSTEM_IDS.typeField]: [{ t: "ref", v: TAG_ID }] } : {},
      children: [],
      createdAt: at,
      updatedAt: at,
    });
  }
  return nodes;
}

function timeQuery(index: DatascriptIndex): number {
  const started = performance.now();
  index.runDatalog(
    `[:find ?id
      :where [?n :f/${SYSTEM_IDS.typeField} ?t]
             [?t :node/id "${TAG_ID}"]
             [?n :node/id ?id]]`,
  );
  return elapsedSince(started);
}

function measure(store: EffectStore): Promise<ReadonlyArray<readonly [string, number]>> {
  return Effect.runPromise(
    Effect.gen(function* () {
      let started = performance.now();
      yield* store.commitEffect({ upserts: benchmarkNodes(AT), deletes: [] });
      const initialCommitMs = elapsedSince(started);

      started = performance.now();
      const loaded = yield* store.loadEffect;
      const loadMs = elapsedSince(started);

      started = performance.now();
      const index = new DatascriptIndex(loaded);
      const datomBuildMs = elapsedSince(started);

      const queryMs = timeQuery(index);

      const target = loaded.find((n) => n.id.startsWith("01BENCH0"));
      if (target === undefined) throw new Error("benchmark fixture node missing");

      started = performance.now();
      yield* store.commitEffect({
        upserts: [{ ...target, text: "set-shaped edit", updatedAt: EDITED_AT }],
        deletes: [],
      });
      const setCommitMs = elapsedSince(started);

      started = performance.now();
      const reloaded = yield* store.loadEffect;
      const edited = reloaded.find((n) => n.id === target.id);
      if (edited === undefined) throw new Error("benchmark edit node missing");
      yield* store.commitEffect({
        upserts: [{ ...edited, text: "interactive edit", updatedAt: EDITED_AT }],
        deletes: [],
      });
      const interactiveEditMs = elapsedSince(started);

      return [
        ["initial commit", initialCommitMs],
        ["load", loadMs],
        ["datom build", datomBuildMs],
        ["query", queryMs],
        ["kb set-shaped commit", setCommitMs],
        ["interactive edit", interactiveEditMs],
      ] as const;
    }),
  );
}

function runBenchmark(name: string, makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "kb-bench-"))),
          (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
        );
        const rows = yield* Effect.promise(() => measure(makeStore(root)));
        printTable(name, rows);
        expect(rows.length).toBe(6);
      }),
    ),
  );
}

/** Register the benchmark for one adapter. Skipped unless explicitly named. */
export function storeBenchmark(name: string, makeStore: StoreFactory): void {
  describe.skipIf(!benchmarkEnabled)(`benchmark 50k — ${name}`, () => {
    test("prints the store benchmark table", () => runBenchmark(name, makeStore), 60_000);
  });
}
