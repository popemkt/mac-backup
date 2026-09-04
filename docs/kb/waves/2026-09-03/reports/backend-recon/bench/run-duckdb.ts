/**
 * Candidate 5a — DuckDB, re-tested because p1 §0's rejection reason expired.
 *
 * p1 rejected DuckDB on "open Bun crash" (oven-sh/bun#17216 -> #13910).
 * #13910 is now **closed**, and `@duckdb/node-api@1.5.5-r.4` opens, queries and
 * evaluates a recursive CTE under Bun 1.3.14 on this machine. So the rejection
 * is re-opened here with a measurement rather than left standing on a stale
 * issue link.
 *
 * The SQL is *not* the shared `lib/sql.ts` set, and that is the finding: DuckDB
 * has no `ANY` column type, no partial indexes, and a different JSON surface,
 * so the EAV schema and three of the eight questions had to be rewritten. A
 * `KbIndex` adapter would need its own DuckDB dialect, not the SQLite one.
 *
 * Usage: bun run-duckdb.ts --scale 100k
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { nodesToDatoms, type KbNode } from "./lib/kb-datoms.ts";
import { gc, heapMB, once, rssMB, scaleArg, writeResult, type Stat } from "./lib/bench.ts";
import { CLOSURE_ROOT, FIELD_STATUS, HUB, ORDERED_PARENT, TAG_ROOT } from "./lib/questions.ts";
import { sqlValue } from "./lib/sql.ts";

const RUNS = 20;
const { file, scale } = scaleArg();
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
const built = await once(() => nodesToDatoms(nodes));
const { datoms, schema } = built.value;
const datomCount = datoms.length;
const refAttrs = new Set(Object.keys(schema).filter((a) => schema[a]?.[":db/valueType"] === ":db.type/ref"));

const inst = await DuckDBInstance.create(":memory:");
const conn = await inst.connect();
const version = ((await (await conn.run("SELECT version() AS v")).getRowObjects())[0] as { v: string }).v;

const ddl = await once(async () => {
  // No `ANY` column: values are stored as VARCHAR and cast at the join. `ref`
  // is BOOLEAN. `e` is BIGINT because DuckDB integers come back as BigInt.
  await conn.run(`CREATE TABLE datoms (e BIGINT NOT NULL, a VARCHAR NOT NULL, v VARCHAR NOT NULL, ref BOOLEAN NOT NULL)`);
  await conn.run(`CREATE TABLE node (id VARCHAR PRIMARY KEY, e BIGINT NOT NULL, doc VARCHAR NOT NULL)`);
  return 1;
});

const insert = await once(async () => {
  // Appender is DuckDB's bulk path; a prepared INSERT per row is orders of
  // magnitude slower in a columnar engine.
  const app = await conn.createAppender("datoms");
  for (const [e, a, v] of datoms) {
    app.appendBigInt(BigInt(e as number));
    app.appendVarchar(a);
    app.appendVarchar(String(sqlValue(v)));
    app.appendBoolean(refAttrs.has(a) && typeof v === "number");
    app.endRow();
  }
  app.closeSync();
  const napp = await conn.createAppender("node");
  const { ids } = built.value;
  for (const n of nodes) {
    napp.appendVarchar(n.id);
    napp.appendBigInt(BigInt(ids.toEid.get(n.id)!));
    napp.appendVarchar(JSON.stringify(n));
    napp.endRow();
  }
  napp.closeSync();
  return 1;
});

const index = await once(async () => {
  // DuckDB's ART indexes only help point lookups and are not covering; there
  // is no AVET/VAET equivalent and no partial-index syntax. Zone maps do the
  // rest. This is the columnar/OLTP mismatch p1 already named, now measured.
  await conn.run(`CREATE INDEX datoms_a ON datoms (a)`);
  await conn.run(`CREATE INDEX datoms_v ON datoms (v)`);
  await conn.run(`ANALYZE`);
  return 1;
});
notes.push(
  "no partial index (`CREATE INDEX ... WHERE ref = 1` is rejected) and no covering composite equivalent of AVET/VAET; DuckDB leans on zone maps instead, so the four-index EAV layout does not transfer",
);
notes.push(
  "no `ANY` column type: every value is stored as VARCHAR and cast at the join, so a numeric prop no longer round-trips through the index as a number",
);
notes.push(
  "results come back as BigInt for integer columns; a `KbIndex` adapter would need a revive step of its own, separate from the eid revive DataScript needs",
);

built.value.datoms.length = 0;
gc();
const rssDeltaMB = +(rssMB() - rss0).toFixed(1);
const heapDeltaMB = +(heapMB() - heap0).toFixed(1);

const ID = ":node/id";
const TEXT = ":node/text";
const TYPE = ":f/sys.f.type";
const EXTENDS = ":f/sys.f.onto.extends";
const STATUS = `:f/${FIELD_STATUS}`;
const s = (v: string) => `'${v.replace(/'/g, "''")}'`;

const Q1 = `SELECT nid.v AS id FROM datoms t
  JOIN datoms tag ON tag.e = t.v::BIGINT AND tag.a = ${s(TEXT)} AND tag.v = 'todo'
  JOIN datoms nid ON nid.e = t.e AND nid.a = ${s(ID)}
  WHERE t.a = ${s(TYPE)}`;
const Q2 = `SELECT nid.v AS id FROM datoms st
  JOIN datoms t   ON t.e = st.e AND t.a = ${s(TYPE)}
  JOIN datoms tag ON tag.e = t.v::BIGINT AND tag.a = ${s(TEXT)} AND tag.v = 'todo'
  JOIN datoms nid ON nid.e = st.e AND nid.a = ${s(ID)}
  WHERE st.a = ${s(STATUS)} AND st.v = 'doing'`;
const Q3 = `SELECT src.v AS id FROM datoms tgt
  JOIN datoms m   ON m.v::BIGINT = tgt.e AND m.a = ':node/mentions' AND m.ref
  JOIN datoms src ON src.e = m.e AND src.a = ${s(ID)}
  WHERE tgt.a = ${s(ID)} AND tgt.v = ${s(HUB)}`;
const Q4 = `WITH RECURSIVE sub(e) AS (
    SELECT e FROM datoms WHERE a = ${s(ID)} AND v = ${s(TAG_ROOT)}
    UNION
    SELECT d.e FROM datoms d JOIN sub ON d.v::BIGINT = sub.e WHERE d.a = ${s(EXTENDS)}
  )
  SELECT nid.v AS id FROM datoms t
    JOIN sub ON sub.e = t.v::BIGINT
    JOIN datoms nid ON nid.e = t.e AND nid.a = ${s(ID)}
  WHERE t.a = ${s(TYPE)}`;
// `json_each` does not exist; DuckDB's equivalent is unnest over a JSON list,
// and ordinality has to be produced with a window function.
const Q5 = `WITH kids AS (
    SELECT unnest(from_json(k.v, '["BIGINT"]')) AS child_e,
           generate_subscripts(from_json(k.v, '["BIGINT"]'), 1) AS ord
    FROM datoms parent
      JOIN datoms k ON k.e = parent.e AND k.a = ':node/children'
    WHERE parent.a = ${s(ID)} AND parent.v = ${s(ORDERED_PARENT)}
  )
  SELECT nid.v AS id, kids.ord FROM kids
    JOIN datoms nid ON nid.e = kids.child_e AND nid.a = ${s(ID)}
  ORDER BY kids.ord`;
const Q6 = `SELECT v, count(*) AS n FROM datoms WHERE a = ${s(STATUS)} GROUP BY v`;
const CL = `WITH RECURSIVE reach(e) AS (
    SELECT d.v::BIGINT FROM datoms d
      JOIN datoms r ON r.e = d.e
     WHERE r.a = ${s(ID)} AND r.v = ${s(CLOSURE_ROOT)} AND d.a = ':node/mentions' AND d.ref
    UNION
    SELECT d.v::BIGINT FROM datoms d JOIN reach ON d.e = reach.e WHERE d.a = ':node/mentions' AND d.ref
  )
  SELECT nid.v AS id FROM reach JOIN datoms nid ON nid.e = reach.e AND nid.a = ${s(ID)}`;
const PULL = `WITH kids AS (
    SELECT unnest(from_json(k.v, '["BIGINT"]')) AS child_e,
           generate_subscripts(from_json(k.v, '["BIGINT"]'), 1) AS ord
    FROM datoms parent
      JOIN datoms k ON k.e = parent.e AND k.a = ':node/children'
    WHERE parent.a = ${s(ID)} AND parent.v = ${s(ORDERED_PARENT)}
  )
  SELECT nid.v AS id, txt.v AS text FROM kids
    JOIN datoms nid ON nid.e = kids.child_e AND nid.a = ${s(ID)}
    JOIN datoms txt ON txt.e = kids.child_e AND txt.a = ${s(TEXT)}
  ORDER BY kids.ord`;

async function measure(label: string, sql: string): Promise<Stat> {
  const samples: number[] = [];
  let rows = 0;
  let spent = 0;
  for (let i = 0; i < RUNS; i++) {
    if (i >= 3 && spent > 8000) break;
    const t = performance.now();
    const r = await conn.run(sql);
    rows = Number(await r.getRowObjects().then((x) => x.length));
    const dt = performance.now() - t;
    spent += dt;
    samples.push(dt);
  }
  samples.sort((a, b) => a - b);
  const qf = (p: number) => +samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]!.toFixed(3);
  return { label, rows, p50: qf(0.5), p90: qf(0.9), min: +samples[0]!.toFixed(3), runs: samples.length };
}

const queries: Stat[] = [
  await measure("Q1 all todos", Q1),
  await measure("Q2 todos status=doing", Q2),
  await measure("Q3 backlinks to hub", Q3),
  await measure("Q4 tag inheritance", Q4),
  await measure("Q5 children of parent", Q5),
  await measure("Q6 count per status", Q6),
  await measure("BL backlinks (=Q3)", Q3),
  await measure("CL closure of mentions", CL),
  await measure("PULL subtree", PULL),
];

const target = nodes[Math.floor(nodes.length / 2)]!;
const targetEid = built.value.ids.toEid.get(target.id)!;
let flip = 0;
const incSamples: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const status = flip++ % 2 === 0 ? "doing" : "done";
  const t = performance.now();
  await conn.run(`DELETE FROM datoms WHERE e = ${targetEid} AND a = ${s(STATUS)}`);
  await conn.run(`INSERT INTO datoms VALUES (${targetEid}, ${s(STATUS)}, ${s(status)}, false)`);
  incSamples.push(performance.now() - t);
}
incSamples.sort((a, b) => a - b);
const incrementalMs: Stat = {
  label: "incremental upsert",
  rows: 1,
  p50: +incSamples[Math.floor(incSamples.length / 2)]!.toFixed(3),
  p90: +incSamples[Math.floor(incSamples.length * 0.9)]!.toFixed(3),
  min: +incSamples[0]!.toFixed(3),
  runs: incSamples.length,
};

await writeResult({
  candidate: "duckdb",
  scale,
  versions: { bun: Bun.version, duckdb: version, "@duckdb/node-api": "1.5.5-r.4" },
  nodes: nodes.length,
  datoms: datomCount,
  coldLoadMs: {
    read: read.ms,
    jsonParse: parsed.ms,
    nodesToDatoms: built.ms,
    ddl: ddl.ms,
    appendDatoms: insert.ms,
    createIndexes: index.ms,
    total: +(read.ms + parsed.ms + built.ms + ddl.ms + insert.ms + index.ms).toFixed(1),
  },
  rssDeltaMB,
  heapDeltaMB,
  queries,
  incrementalMs,
  persistence: { mode: "in-memory here; DuckDB also has a single-file on-disk format (not measured)" },
  notes,
});
