import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlStore } from "../src/foundation/storage/index.ts";
import { systemSeedNodes } from "../src/foundation/seed.ts";
import { buildQueryDb, query } from "../src/foundation/query/index.ts";
import { SYSTEM_IDS, type KbNode, nowIso } from "../src/foundation/model.ts";

const N = 50_000;

describe("benchmark 50k", () => {
  test("load + query well under 1s", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-bench-"));
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
          props:
            i % 10 === 0
              ? { [SYSTEM_IDS.typeField]: [{ t: "ref", v: tagId }] }
              : {},
          children: [],
          createdAt: at,
          updatedAt: at,
        });
      }

      const store = new JsonlStore(root);
      const tWrite0 = performance.now();
      await store.commit({ upserts: nodes, deletes: [] });
      const tWrite = performance.now() - tWrite0;

      const t0 = performance.now();
      const loaded = await store.load();
      const tLoad = performance.now();
      const qdb = buildQueryDb(loaded);
      const tBuild = performance.now();
      const rows = query(
        qdb,
        `[:find ?id
          :where [?n :f/${SYSTEM_IDS.typeField} ?t]
                 [?t :node/id "${tagId}"]
                 [?n :node/id ?id]]`,
      ) as unknown[][];
      const tQuery = performance.now();

      const loadMs = tLoad - t0;
      const buildMs = tBuild - tLoad;
      const queryMs = tQuery - tBuild;
      const totalMs = tQuery - t0;

      console.log(
        `[bench] nodes=${loaded.length} write=${tWrite.toFixed(1)}ms load=${loadMs.toFixed(1)}ms build=${buildMs.toFixed(1)}ms query=${queryMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms rows=${rows.length}`,
      );

      expect(loaded.length).toBe(N + systemSeedNodes().length + 1); // sys seed + 1 tag + N
      // every 10th of N (i % 10 === 0): 5000 nodes
      expect(rows.length).toBe(N / 10);
      expect(totalMs).toBeLessThan(1000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
