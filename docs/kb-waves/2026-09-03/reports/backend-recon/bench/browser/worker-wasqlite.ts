/**
 * Browser candidate 2c — wa-sqlite over OPFS.
 *
 * OPFS sync access handles only exist inside a Worker, so this whole candidate
 * lives in one. wa-sqlite's `AccessHandlePoolVFS` is the OPFS VFS: it
 * pre-allocates a pool of sync access handles and maps SQLite's file ops onto
 * them, which is what makes a *synchronous* SQLite build work against OPFS.
 *
 * Same SQL module as the Bun and sql.js runners.
 */
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import * as SQLiteAPI from "wa-sqlite/src/sqlite-api.js";
// eslint-disable-next-line import/no-unresolved
import { AccessHandlePoolVFS } from "wa-sqlite/src/examples/AccessHandlePoolVFS.js";
import { nodesToDatoms, type KbNode } from "../lib/kb-datoms.ts";
import * as SQL from "../lib/sql.ts";

const HUB = "01N0HUB0000000000000000000";
const CLOSURE_ROOT = "01N0CLOSURE000000000000000";
const ORDERED_PARENT = "01N0PARENT0000000000000000";
const TAG_ROOT = "01N0TAGROOT000000000000000";
const RUNS = 20;

function p50(samples: number[]): number {
  samples.sort((a, b) => a - b);
  return +samples[Math.floor(samples.length / 2)]!.toFixed(3);
}

self.onmessage = async (ev: MessageEvent<{ scale: string }>) => {
  try {
    const scale = ev.data.scale;
    const t0 = performance.now();
    const module = await SQLiteESMFactory({ locateFile: (f: string) => `/vendor/${f}` });
    const sqlite3 = SQLiteAPI.Factory(module);
    const wasmInitMs = +(performance.now() - t0).toFixed(1);

    // `AccessHandlePoolVFS` takes only the OPFS directory and exposes an
    // `isReady` promise; it pre-allocates a pool of sync access handles, which
    // is what lets the *synchronous* wa-sqlite build talk to OPFS at all.
    const tVfs = performance.now();
    const vfs = new AccessHandlePoolVFS("/kb-bench");
    await (vfs as unknown as { isReady: Promise<void> }).isReady;
    sqlite3.vfs_register(vfs, true);
    const vfsMs = +(performance.now() - tVfs).toFixed(1);

    const tOpen = performance.now();
    // A fresh file each run: this measures build-from-JSONL, and the reopen
    // path below measures the "restore from cache" case separately.
    const dbName = `kb-${scale}-${Date.now()}.db`;
    const db = await sqlite3.open_v2(dbName);
    const openMs = +(performance.now() - tOpen).toFixed(1);

    const exec = async (sql: string) => {
      await sqlite3.exec(db, sql);
    };

    const tFetch = performance.now();
    const text = await (await fetch(`/data/${scale}.jsonl`)).text();
    const fetchMs = +(performance.now() - tFetch).toFixed(1);

    const tParse = performance.now();
    const nodes: KbNode[] = [];
    for (const l of text.split("\n")) if (l.length > 0) nodes.push(JSON.parse(l) as KbNode);
    const parseMs = +(performance.now() - tParse).toFixed(1);

    const tBuild = performance.now();
    const { datoms, schema, ids } = nodesToDatoms(nodes);
    const buildMs = +(performance.now() - tBuild).toFixed(1);
    const refAttrs = new Set(
      Object.keys(schema).filter((a) => schema[a]?.[":db/valueType"] === ":db.type/ref"),
    );

    await exec("PRAGMA journal_mode = MEMORY;");
    await exec(SQL.SCHEMA_DDL);

    const tInsert = performance.now();
    await exec("BEGIN");
    for await (const s of sqlite3.statements(db, "INSERT INTO datoms (e,a,v,ref) VALUES (?,?,?,?)")) {
      for (const [e, a, v] of datoms) {
        const isRef = refAttrs.has(a) && typeof v === "number";
        sqlite3.reset(s);
        sqlite3.bind_collection(s, [e as number, a, SQL.sqlValue(v), isRef ? 1 : 0]);
        await sqlite3.step(s);
      }
    }
    for await (const s of sqlite3.statements(db, "INSERT INTO node (id,e,doc) VALUES (?,?,?)")) {
      for (const n of nodes) {
        sqlite3.reset(s);
        sqlite3.bind_collection(s, [n.id, ids.toEid.get(n.id)!, JSON.stringify(n)]);
        await sqlite3.step(s);
      }
    }
    await exec("COMMIT");
    const insertMs = +(performance.now() - tInsert).toFixed(1);

    const tIndex = performance.now();
    await exec(SQL.INDEX_DDL);
    await exec("ANALYZE;");
    const indexMs = +(performance.now() - tIndex).toFixed(1);

    let ftsMs: number | string;
    try {
      const tFts = performance.now();
      await exec(SQL.FTS_DDL);
      ftsMs = +(performance.now() - tFts).toFixed(1);
    } catch (err) {
      ftsMs = `unavailable: ${(err as Error).message}`;
    }

    const { id: ID, text: TEXT, type: TYPE, extends: EXTENDS } = SQL.ATTR;
    const STATUS = SQL.ATTR.status;

    const runQ = async (sql: string, params: unknown[]): Promise<number> => {
      let n = 0;
      for await (const s of sqlite3.statements(db, sql)) {
        sqlite3.bind_collection(s, params as never);
        while ((await sqlite3.step(s)) === SQLiteAPI.SQLITE_ROW) n += 1;
      }
      return n;
    };

    const measure = async (label: string, sql: string, params: unknown[]) => {
      const samples: number[] = [];
      let rows = 0;
      for (let i = 0; i < RUNS; i++) {
        const t = performance.now();
        rows = await runQ(sql, params);
        samples.push(performance.now() - t);
      }
      return { label, rows, p50: p50(samples), runs: RUNS };
    };

    const queries = [
      await measure("Q1 all todos", SQL.Q1, [TYPE, ID, TEXT]),
      await measure("Q2 todos status=doing", SQL.Q2, [STATUS, TYPE, ID, TEXT]),
      await measure("Q3 backlinks to hub", SQL.Q3, [ID, HUB]),
      await measure("Q4 tag inheritance", SQL.Q4, [ID, TYPE, EXTENDS, TAG_ROOT]),
      await measure("Q5 children of parent", SQL.Q5, [ID, ORDERED_PARENT]),
      await measure("Q6 count per status", SQL.Q6, [STATUS]),
      await measure("BL backlinks (=Q3)", SQL.Q3, [ID, HUB]),
      await measure("CL closure of mentions", SQL.CL, [ID, CLOSURE_ROOT]),
      await measure("PULL subtree", SQL.PULL, [ID, ORDERED_PARENT]),
    ];
    if (typeof ftsMs === "number") queries.push(await measure("FTS5 search 'ratchet'", SQL.FTS_SEARCH, ["ratchet"]));

    // The number that matters for the browser: reopening the OPFS-backed file
    // does zero index construction, which is the structural difference from a
    // DataScript snapshot the page has to parse and re-inflate.
    await sqlite3.close(db);
    const tReopen = performance.now();
    const db2 = await sqlite3.open_v2(dbName);
    let reopenRows = 0;
    for await (const s of sqlite3.statements(db2, "SELECT count(*) FROM datoms")) {
      while ((await sqlite3.step(s)) === SQLiteAPI.SQLITE_ROW) reopenRows = sqlite3.column(s, 0) as number;
    }
    const reopenMs = +(performance.now() - tReopen).toFixed(1);
    const tQ1 = performance.now();
    let q1RowsAfterReopen = 0;
    for await (const s of sqlite3.statements(db2, SQL.Q1)) {
      sqlite3.bind_collection(s, [TYPE, ID, TEXT] as never);
      while ((await sqlite3.step(s)) === SQLiteAPI.SQLITE_ROW) q1RowsAfterReopen += 1;
    }
    const q1AfterReopenMs = +(performance.now() - tQ1).toFixed(1);

    self.postMessage({
      candidate: "wa-sqlite-opfs",
      scale,
      nodes: nodes.length,
      datoms: datoms.length,
      coldLoadMs: {
        wasmInit: wasmInitMs,
        vfsCreate: vfsMs,
        openDb: openMs,
        fetchJsonl: fetchMs,
        jsonParse: parseMs,
        nodesToDatoms: buildMs,
        insertDatoms: insertMs,
        createIndexes: indexMs,
        buildFts5: ftsMs,
        total: +(
          wasmInitMs + vfsMs + openMs + fetchMs + parseMs + buildMs + insertMs + indexMs +
          (typeof ftsMs === "number" ? ftsMs : 0)
        ).toFixed(1),
      },
      queries,
      persistence: {
        mode: "OPFS (AccessHandlePoolVFS), durable across reloads",
        reopenAndCountMs: reopenMs,
        datomRowsAfterReopen: reopenRows,
        q1AfterReopenMs,
        q1RowsAfterReopen,
      },
    });
  } catch (err) {
    self.postMessage({ error: `${(err as Error).message}\n${(err as Error).stack}` });
  }
};
