/**
 * Browser candidate 2b — sql.js (SQLite compiled to asm.js/wasm, memory only).
 *
 * Runs the *same* SQL module as the Bun `bun:sqlite` runner, so a statement
 * that needed rewriting for the browser would fail here rather than silently
 * diverge. Reports to `window.__kbResult`, which the playwright driver reads.
 */
import initSqlJs from "sql.js";
import { nodesToDatoms, type KbNode } from "../lib/kb-datoms.ts";
import * as SQL from "../lib/sql.ts";

const HUB = "01N0HUB0000000000000000000";
const CLOSURE_ROOT = "01N0CLOSURE000000000000000";
const ORDERED_PARENT = "01N0PARENT0000000000000000";
const TAG_ROOT = "01N0TAGROOT000000000000000";
const RUNS = 20;

declare global {
  interface Window {
    __kbResult?: unknown;
    __kbError?: string;
  }
}

function p50(samples: number[]): number {
  samples.sort((a, b) => a - b);
  return +samples[Math.floor(samples.length / 2)]!.toFixed(3);
}

async function main() {
  const t0 = performance.now();
  const SQLjs = await initSqlJs({ locateFile: (f: string) => `/vendor/${f}` });
  const wasmInitMs = +(performance.now() - t0).toFixed(1);

  const scale = new URLSearchParams(location.search).get("scale") ?? "100k";
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

  const db = new SQLjs.Database();
  const tInsert = performance.now();
  db.run("BEGIN");
  db.run(SQL.SCHEMA_DDL);
  const stmt = db.prepare("INSERT INTO datoms (e,a,v,ref) VALUES (?,?,?,?)");
  for (const [e, a, v] of datoms) {
    const isRef = refAttrs.has(a) && typeof v === "number";
    stmt.run([e as number, a, SQL.sqlValue(v), isRef ? 1 : 0]);
  }
  stmt.free();
  const nstmt = db.prepare("INSERT INTO node (id,e,doc) VALUES (?,?,?)");
  for (const n of nodes) nstmt.run([n.id, ids.toEid.get(n.id)!, JSON.stringify(n)]);
  nstmt.free();
  db.run("COMMIT");
  const insertMs = +(performance.now() - tInsert).toFixed(1);

  const tIndex = performance.now();
  db.run(SQL.INDEX_DDL);
  db.run("ANALYZE;");
  const indexMs = +(performance.now() - tIndex).toFixed(1);

  let ftsMs: number | string;
  try {
    const tFts = performance.now();
    db.run(SQL.FTS_DDL);
    ftsMs = +(performance.now() - tFts).toFixed(1);
  } catch (err) {
    ftsMs = `unavailable: ${(err as Error).message}`;
  }

  const { id: ID, text: TEXT, type: TYPE, extends: EXTENDS } = SQL.ATTR;
  const STATUS = SQL.ATTR.status;

  const run = (sql: string, params: unknown[]): number => {
    const st = db.prepare(sql);
    st.bind(params as never);
    let n = 0;
    while (st.step()) n += 1;
    st.free();
    return n;
  };

  const measure = (label: string, sql: string, params: unknown[]) => {
    const samples: number[] = [];
    let rows = 0;
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      rows = run(sql, params);
      samples.push(performance.now() - t);
    }
    return { label, rows, p50: p50(samples), runs: RUNS };
  };

  const queries = [
    measure("Q1 all todos", SQL.Q1, [TYPE, ID, TEXT]),
    measure("Q2 todos status=doing", SQL.Q2, [STATUS, TYPE, ID, TEXT]),
    measure("Q3 backlinks to hub", SQL.Q3, [ID, HUB]),
    measure("Q4 tag inheritance", SQL.Q4, [ID, TYPE, EXTENDS, TAG_ROOT]),
    measure("Q5 children of parent", SQL.Q5, [ID, ORDERED_PARENT]),
    measure("Q6 count per status", SQL.Q6, [STATUS]),
    measure("BL backlinks (=Q3)", SQL.Q3, [ID, HUB]),
    measure("CL closure of mentions", SQL.CL, [ID, CLOSURE_ROOT]),
    measure("PULL subtree", SQL.PULL, [ID, ORDERED_PARENT]),
  ];
  if (typeof ftsMs === "number") queries.push(measure("FTS5 search 'ratchet'", SQL.FTS_SEARCH, ["ratchet"]));

  // export() is the browser persistence story: a byte array the page can put
  // in OPFS or IndexedDB itself. Measured because it is the only "save the
  // index" primitive sql.js has.
  const tExport = performance.now();
  const bytes = db.export();
  const exportMs = +(performance.now() - tExport).toFixed(1);

  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;

  window.__kbResult = {
    candidate: "sql.js",
    scale,
    nodes: nodes.length,
    datoms: datoms.length,
    coldLoadMs: {
      wasmInit: wasmInitMs,
      fetchJsonl: fetchMs,
      jsonParse: parseMs,
      nodesToDatoms: buildMs,
      insertDatoms: insertMs,
      createIndexes: indexMs,
      buildFts5: ftsMs,
      total: +(
        wasmInitMs + fetchMs + parseMs + buildMs + insertMs + indexMs + (typeof ftsMs === "number" ? ftsMs : 0)
      ).toFixed(1),
    },
    jsHeapMB: mem ? +(mem.usedJSHeapSize / 1024 / 1024).toFixed(1) : null,
    queries,
    persistence: { exportMs, exportBytes: bytes.length, mode: "in-memory; export() to bytes the page persists itself" },
  };
}

main().catch((err) => {
  window.__kbError = `${(err as Error).message}\n${(err as Error).stack}`;
});
