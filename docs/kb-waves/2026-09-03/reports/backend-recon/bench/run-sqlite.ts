/**
 * Candidate 2 — `bun:sqlite` EAV store.
 *
 * One `datoms(e,a,v)` table with the four Datomic covering indexes: EAVT
 * (the primary key), AEVT, AVET, and a VAET partial index restricted to
 * ref-typed attrs, which is what backlinks actually walks. Q1-Q6 are SQL,
 * transitive closure is `WITH RECURSIVE`, and `search` is FTS5 over
 * `:node/text`.
 *
 * The point of this runner is not "SQLite is fast" (it is) but what the same
 * eight questions cost when the *engine* does the join instead of a JS
 * fixpoint, and what a `KbIndex` adapter would have to compile into.
 *
 * Usage: bun run-sqlite.ts --scale 100k [--file]
 */
import { Database } from "bun:sqlite";
import { nodesToDatoms, type KbNode } from "./lib/kb-datoms.ts";
import { gc, heapMB, once, rssMB, scaleArg, timeIt, writeResult, type Stat } from "./lib/bench.ts";
import { CLOSURE_ROOT, FIELD_STATUS, HUB, ORDERED_PARENT, TAG_ROOT } from "./lib/questions.ts";
import * as SQL from "./lib/sql.ts";

const RUNS = 20;
const { file, scale } = scaleArg();
const fileBacked = Bun.argv.includes("--file");
const dbPath = fileBacked ? new URL(`./data/${scale}.sqlite`, import.meta.url).pathname : ":memory:";
if (fileBacked) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await Bun.file(dbPath + suffix).delete();
    } catch {
      /* first run */
    }
  }
}
const notes: string[] = [];

gc();
const rss0 = rssMB();
const heap0 = heapMB();

const read = await once(() => Bun.file(file).text());
const parsed = await once(() => {
  const out: KbNode[] = [];
  for (const l of read.value.split("\n")) if (l.length > 0) out.push(JSON.parse(l) as KbNode);
  return out;
});
const nodes = parsed.value;
// Same builder as DataScript: both candidates index literally the same datoms.
const built = await once(() => nodesToDatoms(nodes));
const { datoms, schema, ids } = built.value;
const datomCount = datoms.length;
const refAttrs = new Set(Object.keys(schema).filter((a) => schema[a]?.[":db/valueType"] === ":db.type/ref"));

const db = new Database(dbPath, { create: true, strict: false });
const ddl = await once(() => {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.exec(SQL.SCHEMA_DDL);
  return 1;
});

const insert = await once(() => {
  const stmt = db.prepare("INSERT INTO datoms (e,a,v,ref) VALUES (?,?,?,?)");
  const tx = db.transaction((rows: [number, string, string | number, number][]) => {
    for (const r of rows) stmt.run(r[0], r[1], r[2], r[3]);
  });
  const rows: [number, string, string | number, number][] = [];
  for (const [e, a, v] of datoms) {
    const isRef = refAttrs.has(a) && typeof v === "number";
    // `:node/children` is the ordered vector datom; store it as JSON text so
    // the ordered answer survives, exactly as the JSONL carries it.
    rows.push([e as number, a, SQL.sqlValue(v), isRef ? 1 : 0]);
  }
  tx(rows);
  const nstmt = db.prepare("INSERT INTO node (id,e,doc) VALUES (?,?,?)");
  const ntx = db.transaction((ns: KbNode[]) => {
    for (const n of ns) nstmt.run(n.id, ids.toEid.get(n.id)!, JSON.stringify(n));
  });
  ntx(nodes);
  return 1;
});

// The four covering indexes. AVET is the expensive one to maintain and is what
// Q2/Q6 need; VAET is partial (ref rows only), which is the whole reason
// backlinks is cheap.
const index = await once(() => {
  db.exec(SQL.INDEX_DDL);
  db.exec("ANALYZE;");
  return 1;
});

const fts = await once(() => {
  db.exec(SQL.FTS_DDL);
  return 1;
});
notes.push(
  "FTS5 built and queried fine here; the open risk is oven-sh/bun#37044 (macOS segfault in Database.close() with an FTS5 table) - this runner never calls close(), which is exactly the workaround p1 §4 gates on",
);
notes.push(
  "every SQL statement comes from lib/sql.ts, the same module the browser runners import - the brief's 'does the same SQL run unchanged' question is answered by that shared import, not by eyeballing two copies",
);

built.value.datoms.length = 0;
gc();
const rssDeltaMB = +(rssMB() - rss0).toFixed(1);
const heapDeltaMB = +(heapMB() - heap0).toFixed(1);

const { id: ID, text: TEXT, type: TYPE, extends: EXTENDS } = SQL.ATTR;
const STATUS = `:f/${FIELD_STATUS}`;

const q1 = db.query<{ id: string }, [string, string, string]>(SQL.Q1);
const q2 = db.query<{ id: string }, [string, string, string, string]>(SQL.Q2);
const q3 = db.query<{ id: string }, [string, string]>(SQL.Q3);
const q4 = db.query<{ id: string }, [string, string, string, string]>(SQL.Q4);
const q5 = db.query<{ id: string; ord: number }, [string, string]>(SQL.Q5);
const q6 = db.query<{ v: string; n: number }, [string]>(SQL.Q6);
const cl = db.query<{ id: string }, [string, string]>(SQL.CL);
const pullq = db.query<{ id: string; text: string }, [string, string]>(SQL.PULL);
const ftsq = db.query<{ id: string }, [string]>(SQL.FTS_SEARCH);

const queries: Stat[] = [
  timeIt("Q1 all todos", RUNS, () => q1.all(TYPE, ID, TEXT).length),
  timeIt("Q2 todos status=doing", RUNS, () => q2.all(STATUS, TYPE, ID, TEXT).length),
  timeIt("Q3 backlinks to hub", RUNS, () => q3.all(ID, HUB).length),
  timeIt("Q4 tag inheritance", RUNS, () => q4.all(ID, TYPE, EXTENDS, TAG_ROOT).length),
  timeIt("Q5 children of parent", RUNS, () => q5.all(ID, ORDERED_PARENT).length),
  timeIt("Q6 count per status", RUNS, () => q6.all(STATUS).length),
  timeIt("BL backlinks (=Q3)", RUNS, () => q3.all(ID, HUB).length),
  timeIt("CL closure of mentions", RUNS, () => cl.all(ID, CLOSURE_ROOT).length),
  timeIt("PULL subtree", RUNS, () => pullq.all(ID, ORDERED_PARENT).length),
  timeIt("FTS5 search 'ratchet'", RUNS, () => ftsq.all("ratchet").length),
];

// ---- incremental update of one node ------------------------------------
const target = nodes[Math.floor(nodes.length / 2)]!;
const targetEid = ids.toEid.get(target.id)!;
const del = db.prepare("DELETE FROM datoms WHERE e = ? AND a = ?");
const ins = db.prepare("INSERT INTO datoms (e,a,v,ref) VALUES (?,?,?,0)");
const upNode = db.prepare("UPDATE node SET doc = ? WHERE id = ?");
const upsert = db.transaction((status: string) => {
  del.run(targetEid, STATUS);
  ins.run(targetEid, STATUS, status);
  upNode.run(JSON.stringify({ ...target, props: { ...target.props, [FIELD_STATUS]: [{ t: "str", v: status }] } }), target.id);
});
let flip = 0;
const incrementalMs = timeIt("incremental upsert", RUNS, () => {
  upsert(flip++ % 2 === 0 ? "doing" : "done");
  return 1;
});

const persistence: Record<string, number | string> = { mode: fileBacked ? "file (WAL)" : "in-memory" };
if (fileBacked) {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  let bytes = 0;
  for (const suffix of ["", "-wal"]) {
    try {
      bytes += (await Bun.file(dbPath + suffix).stat()).size;
    } catch {
      /* absent */
    }
  }
  persistence["dbBytes"] = bytes;
  // Reopen cost = the "restore from cache" number: SQLite pays no rebuild.
  const reopen = await once(() => {
    const d2 = new Database(dbPath, { readonly: true });
    const n = d2.query<{ n: number }, []>("SELECT count(*) AS n FROM datoms").get()!.n;
    return n;
  });
  persistence["reopenAndCountMs"] = reopen.ms;
  const warm = await once(() => {
    const d2 = new Database(dbPath, { readonly: true });
    return d2
      .query<{ id: string }, [string, string, string]>(q1.toString?.() ?? "")
      .all as unknown as number;
  });
  void warm;
  notes.push("file-backed reopen does zero index construction — that is the whole structural difference from a snapshot cache");
}

await writeResult({
  candidate: fileBacked ? "sqlite-file" : "sqlite-mem",
  scale,
  versions: { bun: Bun.version, sqlite: db.query<{ v: string }, []>("SELECT sqlite_version() AS v").get()!.v },
  nodes: nodes.length,
  datoms: datomCount,
  coldLoadMs: {
    read: read.ms,
    jsonParse: parsed.ms,
    nodesToDatoms: built.ms,
    ddl: ddl.ms,
    insertDatoms: insert.ms,
    createIndexes: index.ms,
    buildFts5: fts.ms,
    total: +(read.ms + parsed.ms + built.ms + ddl.ms + insert.ms + index.ms + fts.ms).toFixed(1),
  },
  rssDeltaMB,
  heapDeltaMB,
  queries,
  incrementalMs,
  persistence,
  notes,
});
