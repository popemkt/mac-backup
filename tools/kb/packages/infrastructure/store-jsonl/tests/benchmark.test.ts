import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlStore } from "../src/index.ts";
import { decodeNodes } from "../src/jsonl-store.ts";
import { systemSeedNodes, SYSTEM_IDS, type KbNode, nowIso } from "@kb/model";
import { DatascriptIndex } from "@kb/query";

const N = 50_000;
const benchmarkEnabled = Bun.argv.some((arg) => arg.endsWith("benchmark.test.ts"));

function elapsedSince(start: number): number {
  return performance.now() - start;
}

function printTable(rows: ReadonlyArray<readonly [string, number]>): void {
  console.log("| phase | ms |");
  console.log("|---|---:|");
  for (const [phase, ms] of rows) console.log(`| ${phase} | ${ms.toFixed(1)} |`);
}

describe.skipIf(!benchmarkEnabled)("benchmark 50k", () => {
  test("prints the store benchmark table", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-bench-"));
    let ran = false;
    try {
      const at = nowIso();
      const nodes: KbNode[] = systemSeedNodes(at);
      const tagId = "01BENCHTAG0000000000000001";
      nodes.push({
        id: tagId,
        text: "bench",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
        },
        children: [],
        createdAt: at,
        updatedAt: at,
      });

      for (let i = 0; i < N; i++) {
        const id = `01BENCH${String(i).padStart(20, "0")}`;
        nodes.push({
          id,
          text: `node ${i}`,
          props: i % 10 === 0 ? { [SYSTEM_IDS.typeField]: [{ t: "ref", v: tagId }] } : {},
          children: [],
          createdAt: at,
          updatedAt: at,
        });
      }

      const store = new JsonlStore(root);
      await store.commit({ upserts: nodes, deletes: [] });

      let started = performance.now();
      const body = await Bun.file(store.path).text();
      const readMs = elapsedSince(started);

      started = performance.now();
      const loaded = await Effect.runPromise(decodeNodes(body, store.path));
      const decodeMs = elapsedSince(started);

      started = performance.now();
      const index = new DatascriptIndex(loaded);
      const datomBuildMs = elapsedSince(started);

      started = performance.now();
      index.runDatalog(
        `[:find ?id
          :where [?n :f/${SYSTEM_IDS.typeField} ?t]
                 [?t :node/id "${tagId}"]
                 [?n :node/id ?id]]`,
      );
      const queryMs = elapsedSince(started);

      const target = loaded.find((node) => node.id.startsWith("01BENCH0"));
      if (target === undefined) throw new Error("benchmark fixture node missing");

      started = performance.now();
      await store.commit({
        upserts: [{ ...target, text: "set-shaped edit", updatedAt: nowIso() }],
        deletes: [],
      });
      const setCommitMs = elapsedSince(started);

      started = performance.now();
      const reloaded = await store.load();
      const edited = reloaded.find((node) => node.id === target.id);
      if (edited === undefined) throw new Error("benchmark edit node missing");
      await store.commit({
        upserts: [{ ...edited, text: "interactive edit", updatedAt: nowIso() }],
        deletes: [],
      });
      const interactiveEditMs = elapsedSince(started);

      printTable([
        ["read", readMs],
        ["decode", decodeMs],
        ["datom build", datomBuildMs],
        ["query", queryMs],
        ["kb set-shaped commit", setCommitMs],
        ["interactive edit", interactiveEditMs],
      ]);
      console.log(`nodes: ${loaded.length}`);
      ran = true;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect(ran).toBe(true);
  }, 30_000);
});
