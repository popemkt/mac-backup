/**
 * Candidate 5b — LadybugDB (the community Kuzu fork), re-tested because p1 §0's
 * rejection reason ("too new, native addon, no Bun evidence") has an expiry
 * date and this is it: `@ladybugdb/core@0.20.2` (MIT) ships a prebuilt
 * darwin-arm64 addon that `process.dlopen`s under Bun 1.3.14, and a bounded
 * Cypher path query with `length(p)` returns a path length — the one capability
 * the datalog-vs-cypher report says datalog cannot express at all.
 *
 * The interesting cost is the *model*, not the latency. LadybugDB is a
 * fixed-schema LPG: you declare node and rel tables up front. kb's `:f/<id>`
 * attributes are minted per field node at runtime, so there is no column to
 * declare — every prop has to be reified into an edge. That is exactly the
 * "edge explosion" the datalog-vs-cypher report predicted, and this runner
 * measures it:
 *
 *   NODE TABLE Node(id, text, createdAt, updatedAt)
 *   REL  TABLE CHILD(FROM Node TO Node, ord INT64)     <- native edge property
 *   REL  TABLE MENTIONS(FROM Node TO Node)
 *   REL  TABLE SCALAR(FROM Node TO Node, value STRING) <- node -> field node
 *   REL  TABLE REFPROP(FROM Node TO Node, field STRING)<- node -> target node
 *
 * Usage: bun run-ladybug.ts --scale 100k
 */
import { Connection, Database } from "@ladybugdb/core";
import { MENTION_RE, nodesToDatoms, type KbNode } from "./lib/kb-datoms.ts";
import { gc, heapMB, once, rssMB, scaleArg, writeResult, type Stat } from "./lib/bench.ts";
import { CLOSURE_ROOT, FIELD_STATUS, HUB, ORDERED_PARENT, TAG_ROOT } from "./lib/questions.ts";

const RUNS = 20;
const { file, scale } = scaleArg();
const notes: string[] = [];
const dir = new URL(`./data/${scale}.ladybug`, import.meta.url).pathname;
await Bun.$`rm -rf ${dir}`.quiet().nothrow();

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
const known = new Set(nodes.map((n) => n.id));
const datomCount = nodesToDatoms(nodes).datoms.length;

// ---- COPY FROM is the only bulk path; build CSVs -----------------------
const csvDir = new URL(`./data/${scale}.ladybug-csv/`, import.meta.url).pathname;
await Bun.$`mkdir -p ${csvDir}`.quiet();
const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;
const edgeCounts = { child: 0, mentions: 0, scalar: 0, refprop: 0 };
const prep = await once(async () => {
  const nodeRows: string[] = [];
  const childRows: string[] = [];
  const mentionRows: string[] = [];
  const scalarRows: string[] = [];
  const refRows: string[] = [];
  for (const n of nodes) {
    nodeRows.push([csv(n.id), csv(n.text), csv(n.createdAt), csv(n.updatedAt)].join(","));
    let ord = 0;
    for (const c of n.children) {
      if (!known.has(c)) continue;
      childRows.push([csv(n.id), csv(c), String(ord)].join(","));
      ord += 1;
      edgeCounts.child += 1;
    }
    const mentioned = new Set<string>();
    for (const [fieldId, vs] of Object.entries(n.props)) {
      for (const pv of vs) {
        if (pv.t === "ref" && known.has(pv.v)) {
          refRows.push([csv(n.id), csv(pv.v), csv(fieldId)].join(","));
          edgeCounts.refprop += 1;
          mentioned.add(pv.v);
        } else if (known.has(fieldId)) {
          // The field node must exist for the reified edge to have a target —
          // a prop keyed by a field id that is not itself a node cannot be
          // modelled as an edge at all. Those fall out of the graph here.
          scalarRows.push([csv(n.id), csv(fieldId), csv(String(pv.v))].join(","));
          edgeCounts.scalar += 1;
        }
      }
    }
    MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_RE.exec(n.text)) !== null) {
      const t = m[1]!.trim();
      if (known.has(t)) mentioned.add(t);
    }
    for (const t of mentioned) {
      mentionRows.push([csv(n.id), csv(t)].join(","));
      edgeCounts.mentions += 1;
    }
  }
  await Bun.write(`${csvDir}node.csv`, nodeRows.join("\n") + "\n");
  await Bun.write(`${csvDir}child.csv`, childRows.join("\n") + "\n");
  await Bun.write(`${csvDir}mentions.csv`, mentionRows.join("\n") + "\n");
  await Bun.write(`${csvDir}scalar.csv`, scalarRows.join("\n") + "\n");
  await Bun.write(`${csvDir}refprop.csv`, refRows.join("\n") + "\n");
  return 1;
});

const db = new Database(dir);
const conn = new Connection(db);
const run = async (cypher: string) => {
  const r = await conn.query(cypher);
  return (await r.getAll()) as Record<string, unknown>[];
};

const ddl = await once(async () => {
  await run(`CREATE NODE TABLE Node(id STRING PRIMARY KEY, text STRING, createdAt STRING, updatedAt STRING)`);
  await run(`CREATE REL TABLE CHILD(FROM Node TO Node, ord INT64)`);
  await run(`CREATE REL TABLE MENTIONS(FROM Node TO Node)`);
  await run(`CREATE REL TABLE SCALAR(FROM Node TO Node, value STRING)`);
  await run(`CREATE REL TABLE REFPROP(FROM Node TO Node, field STRING)`);
  return 1;
});

const copy = await once(async () => {
  await run(`COPY Node FROM '${csvDir}node.csv' (HEADER=false, PARALLEL=false)`);
  await run(`COPY CHILD FROM '${csvDir}child.csv' (HEADER=false, PARALLEL=false)`);
  await run(`COPY MENTIONS FROM '${csvDir}mentions.csv' (HEADER=false, PARALLEL=false)`);
  await run(`COPY SCALAR FROM '${csvDir}scalar.csv' (HEADER=false, PARALLEL=false)`);
  await run(`COPY REFPROP FROM '${csvDir}refprop.csv' (HEADER=false, PARALLEL=false)`);
  return 1;
});

gc();
const rssDeltaMB = +(rssMB() - rss0).toFixed(1);
const heapDeltaMB = +(heapMB() - heap0).toFixed(1);

const TYPE = "sys.f.type";
const EXTENDS = "sys.f.onto.extends";

const Q1 = `MATCH (n:Node)-[r:REFPROP]->(t:Node) WHERE r.field = '${TYPE}' AND t.text = 'todo' RETURN n.id AS id`;
const Q2 = `MATCH (n:Node)-[r:REFPROP]->(t:Node), (n)-[s:SCALAR]->(f:Node)
  WHERE r.field = '${TYPE}' AND t.text = 'todo' AND f.id = '${FIELD_STATUS}' AND s.value = 'doing'
  RETURN n.id AS id`;
const Q3 = `MATCH (src:Node)-[:MENTIONS]->(t:Node) WHERE t.id = '${HUB}' RETURN src.id AS id`;
// Recursive rel pattern with a per-hop predicate — Cypher's answer to the
// hand-written `subtag` rule. `*0..` covers "tagged with the root itself".
const Q4 = `MATCH (n:Node)-[r:REFPROP]->(tag:Node)-[e:REFPROP*0..10 (rr, _ | WHERE rr.field = '${EXTENDS}')]->(root:Node)
  WHERE r.field = '${TYPE}' AND root.id = '${TAG_ROOT}'
  RETURN n.id AS id`;
// Native edge property: order is on the edge, no vector datom, no json_each.
const Q5 = `MATCH (p:Node)-[c:CHILD]->(k:Node) WHERE p.id = '${ORDERED_PARENT}' RETURN k.id AS id, c.ord AS ord ORDER BY c.ord`;
const Q6 = `MATCH (n:Node)-[s:SCALAR]->(f:Node) WHERE f.id = '${FIELD_STATUS}' RETURN s.value AS v, count(*) AS n`;
// A plain recursive rel pattern (`-[:MENTIONS*1..30]->`) enumerates *paths*,
// not the reachable set: with DISTINCT on the endpoint it still walked for
// over six minutes at 100 k without returning, so it was abandoned. `SHORTEST`
// is the idiomatic set-reachability form and is what a real adapter would
// compile "closure" to — recorded because "Cypher has variable-length paths"
// is true but does not by itself mean "closure is cheap".
const CL_NAIVE = `MATCH (r:Node)-[:MENTIONS*1..30]->(n:Node) WHERE r.id = '${CLOSURE_ROOT}' RETURN DISTINCT n.id AS id`;
const CL = `MATCH (r:Node)-[:MENTIONS* SHORTEST 1..30]->(n:Node) WHERE r.id = '${CLOSURE_ROOT}' RETURN n.id AS id`;
const PULL = `MATCH (p:Node)-[c:CHILD]->(k:Node) WHERE p.id = '${ORDERED_PARENT}' RETURN k.id AS id, k.text AS text ORDER BY c.ord`;
// The capability datalog does not have at all: the path as a value.
const PATH = `MATCH p = (a:Node)-[:MENTIONS* SHORTEST 1..5]->(b:Node) WHERE a.id = '${CLOSURE_ROOT}' RETURN length(p) AS len, b.id AS id LIMIT 100`;
const SHORTEST = `MATCH p = (a:Node)-[:MENTIONS* SHORTEST 1..30]->(b:Node) WHERE a.id = '${CLOSURE_ROOT}' RETURN count(*) AS n`;

async function measure(label: string, cypher: string): Promise<Stat> {
  const samples: number[] = [];
  let rows = 0;
  let spent = 0;
  for (let i = 0; i < RUNS; i++) {
    if (i >= 3 && spent > 8000) break;
    const t = performance.now();
    rows = (await run(cypher)).length;
    const dt = performance.now() - t;
    spent += dt;
    samples.push(dt);
  }
  samples.sort((a, b) => a - b);
  const qf = (p: number) => +samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]!.toFixed(3);
  return { label, rows, p50: qf(0.5), p90: qf(0.9), min: +samples[0]!.toFixed(3), runs: samples.length };
}

async function tryMeasure(label: string, cypher: string): Promise<Stat> {
  try {
    // Single-shot first, with a wall-clock guard: an LPG query that explodes
    // should be reported as "too slow to measure", not hang the runner.
    const t = performance.now();
    const first = await Promise.race([
      run(cypher).then((r) => r.length),
      new Promise<number>((_, rej) => setTimeout(() => rej(new Error("timeout after 60s")), 60_000)),
    ]);
    const firstMs = +(performance.now() - t).toFixed(1);
    console.log(`  [${label}] first run ${firstMs} ms, ${first} rows`);
    if (firstMs > 8000) {
      return { label: `${label} (single run only)`, rows: first, p50: firstMs, p90: firstMs, min: firstMs, runs: 1 };
    }
    return await measure(label, cypher);
  } catch (err) {
    notes.push(`${label} FAILED: ${(err as Error).message.split("\n")[0]}`);
    return { label: `${label} (unsupported)`, rows: -1, p50: -1, p90: -1, min: -1, runs: 0 };
  }
}

const queries: Stat[] = [
  await tryMeasure("Q1 all todos", Q1),
  await tryMeasure("Q2 todos status=doing", Q2),
  await tryMeasure("Q3 backlinks to hub", Q3),
  await tryMeasure("Q4 tag inheritance", Q4),
  await tryMeasure("Q5 children of parent", Q5),
  await tryMeasure("Q6 count per status", Q6),
  await tryMeasure("BL backlinks (=Q3)", Q3),
  await tryMeasure("CL closure of mentions", CL),
  await tryMeasure("PULL subtree", PULL),
  await tryMeasure("PATH paths as values", PATH),
  await tryMeasure("SHORTEST shortest paths", SHORTEST),
];

const target = nodes[Math.floor(nodes.length / 2)]!;
const incSamples: number[] = [];
let flip = 0;
for (let i = 0; i < RUNS; i++) {
  const status = flip++ % 2 === 0 ? "doing" : "done";
  const t = performance.now();
  await run(
    `MATCH (n:Node)-[s:SCALAR]->(f:Node) WHERE n.id = '${target.id}' AND f.id = '${FIELD_STATUS}' DELETE s`,
  );
  await run(
    `MATCH (n:Node), (f:Node) WHERE n.id = '${target.id}' AND f.id = '${FIELD_STATUS}' CREATE (n)-[:SCALAR {value: '${status}'}]->(f)`,
  );
  incSamples.push(performance.now() - t);
}
incSamples.sort((a, b) => a - b);

// LadybugDB persists to a single file plus a sidecar WAL, not a directory.
let dbBytes = 0;
for (const suffix of ["", ".wal", ".shadow", ".tmp"]) {
  try {
    dbBytes += (await Bun.file(dir + suffix).stat()).size;
  } catch {
    /* absent */
  }
}
const reopen = await once(async () => {
  const d2 = new Database(dir);
  const c2 = new Connection(d2);
  const r = await c2.query(`MATCH (n:Node) RETURN count(*) AS n`);
  return (await r.getAll())[0];
});

notes.push(
  "closure via a plain `-[:MENTIONS*1..30]->` + DISTINCT did not return within six minutes at 100 k (path enumeration, not set reachability); the measured CL row uses `* SHORTEST`, which is the form an adapter would have to emit",
);
notes.push(
  `reification cost, measured: ${edgeCounts.scalar} SCALAR + ${edgeCounts.refprop} REFPROP + ${edgeCounts.mentions} MENTIONS + ${edgeCounts.child} CHILD edges = ${edgeCounts.scalar + edgeCounts.refprop + edgeCounts.mentions + edgeCounts.child} edges for ${nodes.length} nodes, against ${datomCount} datoms for the same graph`,
);
notes.push(
  "fixed schema is the real constraint: `:f/<fieldId>` attrs are minted per field node at runtime, so there is no column to declare and every prop must become an edge. A prop keyed by a field id that is not itself a node cannot be modelled at all",
);
notes.push(
  "bulk load goes through COPY FROM csv; there is no in-process array ingest, so the whole graph is written to five CSV files first (charged to prepareCsv below), and node text containing newlines forces PARALLEL=false on the CSV reader",
);

await writeResult({
  candidate: "ladybugdb",
  scale,
  versions: { bun: Bun.version, "@ladybugdb/core": "0.20.2" },
  nodes: nodes.length,
  datoms: datomCount,
  coldLoadMs: {
    read: read.ms,
    jsonParse: parsed.ms,
    prepareCsv: prep.ms,
    ddl: ddl.ms,
    copyFrom: copy.ms,
    total: +(read.ms + parsed.ms + prep.ms + ddl.ms + copy.ms).toFixed(1),
  },
  rssDeltaMB,
  heapDeltaMB,
  queries,
  incrementalMs: {
    label: "incremental upsert",
    rows: 1,
    p50: +incSamples[Math.floor(incSamples.length / 2)]!.toFixed(3),
    p90: +incSamples[Math.floor(incSamples.length * 0.9)]!.toFixed(3),
    min: +incSamples[0]!.toFixed(3),
    runs: incSamples.length,
  },
  persistence: {
    mode: "single on-disk file, durable; reopen does no index construction",
    dbBytes,
    reopenAndCountMs: reopen.ms,
    edgeTotal: edgeCounts.scalar + edgeCounts.refprop + edgeCounts.mentions + edgeCounts.child,
  },
  notes,
});

// The native addon keeps a handle alive after the last query, so the process
// does not exit on its own; without this the serial runner stalls after the
// result is written. Worth knowing before embedding it in a long-lived server.
process.exit(0);
