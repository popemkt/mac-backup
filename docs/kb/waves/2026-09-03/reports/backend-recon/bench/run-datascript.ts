/**
 * Candidate 1 — DataScript as-is (the baseline), plus the two variants the
 * r4 brief asks about: the p1 Phase-1 batched decode, and the p1 Phase-3
 * `d.serializable` snapshot cache.
 *
 * The load path mirrors production: read file, split lines, JSON.parse each,
 * nodesToDatoms, d.init_db. No Effect Schema decode here — this bench measures
 * the *index*, and the decode cost is already measured in
 * reports/measurements.md §7 (170 ms per-line vs 84 ms batched at 50 k).
 *
 * Usage: bun run-datascript.ts --scale 100k [--snapshot]
 */
import * as d from "datascript";
import { nodesToDatoms, normalizeEdnQuery, type KbNode } from "./lib/kb-datoms.ts";
import { gc, heapMB, once, rssMB, scaleArg, timeIt, writeResult, type Stat } from "./lib/bench.ts";
import { CLOSURE_ROOT, FIELD_STATUS, HUB, ORDERED_PARENT, TAG_ROOT } from "./lib/questions.ts";

const RUNS = 20;
const { file, scale } = scaleArg();

const q = (edn: string, db: unknown, ...inputs: unknown[]) =>
  d.q(normalizeEdnQuery(edn), db, ...inputs) as unknown[];

// ---- the eight questions as EDN -----------------------------------------
const Q1 = `[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id] [?n :node/text ?text]]`;
const Q2 = `[:find ?id ?text :in $ ?status :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :f/${FIELD_STATUS} ?status] [?n :node/id ?id] [?n :node/text ?text]]`;
const Q3 = `[:find ?srcId :in $ ?targetId :where [?target :node/id ?targetId] [?src :node/mentions ?target] [?src :node/id ?srcId]]`;
// Q4 needs a rule: "tagged with ?t, or with any tag transitively extending ?t".
// Rule bodies must go through `normalizeEdnQuery` too: an un-normalized `:f/…`
// stays a keyword inside the rule while the datoms hold strings, and DataScript
// dies with "Cannot compare :node/created-at to :f/sys.f.onto.extends" during
// fixpoint evaluation. Worth stating because kb's own `query()` normalizes only
// the query, and every rules argument is supplied by a caller.
const RULES_SUBTAG = `[[(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?parent]]
                       [(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?mid] (subtag ?mid ?parent)]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?tag]]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?sub] (subtag ?sub ?tag)]]`;
const Q4 = `[:find ?id :in $ % ?tagId :where [?tag :node/id ?tagId] (has-tag ?n ?tag) [?n :node/id ?id]]`;
// `:node/child-order` is a per-parent set in EAV, not an edge property, so
// joining it here yields the cartesian product (36 children x 36 orders). The
// ordered answer lives in the parent's `:node/children` vector, which is what
// the code reads — so Q5 asks the child-set question and order is a projection.
const Q5 = `[:find ?cId :in $ ?parentId :where [?p :node/id ?parentId] [?p :node/child ?c] [?c :node/id ?cId]]`;
const Q6 = `[:find ?status (count ?n) :where [?n :f/${FIELD_STATUS} ?status]]`;
const RULES_REACH = `[[(reach ?a ?b) [?a :node/mentions ?b]]
                      [(reach ?a ?b) [?a :node/mentions ?mid] (reach ?mid ?b)]]`;
const norm = normalizeEdnQuery;
const CL = `[:find ?id :in $ % ?rootId :where [?root :node/id ?rootId] (reach ?root ?n) [?n :node/id ?id]]`;
const PULL = `[:node/id :node/text {:node/child [:node/id :node/text]}]`;

const useSnapshot = Bun.argv.includes("--snapshot");
const notes: string[] = [];

gc();
const rss0 = rssMB();
const heap0 = heapMB();

// ---- cold load ----------------------------------------------------------
const read = await once(() => Bun.file(file).text());
const parsed = await once(() => {
  const out: KbNode[] = [];
  const lines = read.value.split("\n");
  for (const l of lines) if (l.length > 0) out.push(JSON.parse(l) as KbNode);
  return out;
});
const nodes = parsed.value;
const built = await once(() => nodesToDatoms(nodes));
const { datoms, schema, ids } = built.value;
const datomCount = datoms.length;
const init = await once(() => d.init_db(datoms, schema));
let db = init.value;
const nodeMap = await once(() => new Map(nodes.map((n) => [n.id, n])));

// Release the transient datom + schema arrays before measuring: production
// keeps `db`, `ids` and the node map, not the builder's scratch. Keeping them
// alive would charge DataScript for ~100 k throwaway JS arrays.
built.value.datoms.length = 0;
gc();
const rssDeltaMB = +(rssMB() - rss0).toFixed(1);
const heapDeltaMB = +(heapMB() - heap0).toFixed(1);

// ---- snapshot persistence (p1 Phase 3) ---------------------------------
const persistence: Record<string, number | string> = {};
if (useSnapshot) {
  const snapPath = new URL(`./data/${scale}.dssnapshot.json`, import.meta.url).pathname;
  const ser = await once(() => d.serializable(db));
  const strung = await once(() => JSON.stringify(ser.value));
  await Bun.write(snapPath, strung.value);
  persistence["serializeMs"] = ser.ms;
  persistence["stringifyMs"] = strung.ms;
  persistence["snapshotBytes"] = strung.value.length;
  const txt = await once(() => Bun.file(snapPath).text());
  const jp = await once(() => JSON.parse(txt.value) as unknown);
  const restored = await once(() => d.from_serializable(jp.value));
  persistence["readMs"] = txt.ms;
  persistence["jsonParseMs"] = jp.ms;
  persistence["fromSerializableMs"] = restored.ms;
  persistence["restoreTotalMs"] = +(txt.ms + jp.ms + restored.ms).toFixed(1);
  // correctness: the restored db must answer Q1 identically
  const a = q(Q1, db).length;
  const b = q(Q1, restored.value).length;
  notes.push(
  "rules arguments must be normalized like the query itself; kb's query() normalizes only the query string, so a caller-supplied rules vector with `:f/...` attrs throws inside DataScript",
);
notes.push(`snapshot restore Q1 rows ${b} vs fresh ${a} — ${a === b ? "identical" : "DIVERGED"}`);
  db = restored.value;
}

// ---- queries ------------------------------------------------------------
const queries: Stat[] = [
  timeIt("Q1 all todos", RUNS, () => q(Q1, db).length),
  timeIt("Q2 todos status=doing", RUNS, () => q(Q2, db, "doing").length),
  timeIt("Q3 backlinks to hub", RUNS, () => q(Q3, db, HUB).length),
  timeIt("Q4 tag inheritance", RUNS, () => q(Q4, db, norm(RULES_SUBTAG), TAG_ROOT).length),
  timeIt("Q5 children of parent", RUNS, () => q(Q5, db, ORDERED_PARENT).length),
  timeIt("Q6 count per status", RUNS, () => q(Q6, db).length),
  timeIt("BL backlinks (=Q3)", RUNS, () => q(Q3, db, HUB).length),
  timeIt("CL closure of mentions", RUNS, () => q(CL, db, norm(RULES_REACH), CLOSURE_ROOT).length),
  timeIt("PULL subtree", RUNS, () => {
    const r = d.pull(db, normalizeEdnQuery(PULL), ids.toEid.get(ORDERED_PARENT)!) as Record<string, unknown>;
    return Array.isArray(r[":node/child"]) ? (r[":node/child"] as unknown[]).length : 1;
  }),
];

// ---- incremental update of one node ------------------------------------
// The p1 Phase-2b shape: retract the entity's old datoms, add the node's new
// ones, apply with d.db_with. No rebuild, and no schema growth (status is an
// existing string attr), so this is the fast case rather than the fallback.
const target = nodes[Math.floor(nodes.length / 2)]!;
const targetEid = ids.toEid.get(target.id)!;
let flip = 0;
const incrementalMs = timeIt("incremental upsert", RUNS, () => {
  const status = flip++ % 2 === 0 ? "doing" : "done";
  db = d.db_with(db, [
    [":db.fn/retractAttribute", targetEid, `:f/${FIELD_STATUS}`],
    [":db/add", targetEid, `:f/${FIELD_STATUS}`, status],
  ]);
  return 1;
});
notes.push(
  "incremental upsert = one d.db_with with a retract+add pair on an existing string attr; a first-seen ref attr still forces a full rebuild (p1 2b)",
);

await writeResult({
  candidate: useSnapshot ? "datascript-snapshot" : "datascript",
  scale,
  versions: { bun: Bun.version, datascript: "1.8.1" },
  nodes: nodes.length,
  datoms: datomCount,
  coldLoadMs: {
    read: read.ms,
    jsonParse: parsed.ms,
    nodesToDatoms: built.ms,
    initDb: init.ms,
    nodeMap: nodeMap.ms,
    total: +(read.ms + parsed.ms + built.ms + init.ms + nodeMap.ms).toFixed(1),
  },
  rssDeltaMB,
  heapDeltaMB,
  queries,
  incrementalMs,
  ...(useSnapshot ? { persistence } : {}),
  notes,
});
