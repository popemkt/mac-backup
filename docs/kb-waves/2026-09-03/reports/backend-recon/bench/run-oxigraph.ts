/**
 * Candidate 3 — Oxigraph (npm `oxigraph`, Rust RDF store compiled to wasm).
 *
 * kb's nodes/props/children/mentions map onto RDF triples almost 1:1, which is
 * the interesting part: EAV *is* a triple store, so this is the one candidate
 * whose data model needs no reshaping at all.
 *
 *   <urn:kb:n:ID>  <urn:kb:p:text>       "…"
 *   <urn:kb:n:ID>  <urn:kb:f:FIELDID>    "…"            scalar prop
 *   <urn:kb:n:ID>  <urn:kb:f:FIELDID>    <urn:kb:n:ID2> ref prop
 *   <urn:kb:n:ID>  <urn:kb:p:child>      <urn:kb:n:ID2>
 *   <urn:kb:n:ID>  <urn:kb:p:mentions>   <urn:kb:n:ID2>
 *
 * The one place RDF costs something is child *order*: like EAV, RDF has no edge
 * properties, so order needs either edge reification (+3 triples per child) or
 * an out-of-band ordered literal. This runner uses the literal, mirroring what
 * the SQLite runner does with `json_each`, so the triple count stays comparable
 * to the datom count.
 *
 * Q4 and CL use SPARQL 1.1 property paths (`*` / `+`) — the feature datalog
 * needs a hand-written recursive rule for.
 *
 * Usage: bun run-oxigraph.ts --scale 100k
 */
import oxigraph from "oxigraph";
import { MENTION_RE, type KbNode } from "./lib/kb-datoms.ts";
import { gc, heapMB, once, rssMB, scaleArg, timeIt, writeResult, type Stat } from "./lib/bench.ts";
import { CLOSURE_ROOT, FIELD_STATUS, HUB, ORDERED_PARENT, TAG_ROOT } from "./lib/questions.ts";

const RUNS = 20;
const { file, scale } = scaleArg();
const notes: string[] = [];

const N = (id: string) => `<urn:kb:n:${id}>`;
const P = (p: string) => `<urn:kb:p:${p}>`;
const F = (f: string) => `<urn:kb:f:${f}>`;
function lit(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

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

// ---- serialise to N-Triples (this is Oxigraph's only bulk-load door) ----
const ser = await once(() => {
  const out: string[] = [];
  let triples = 0;
  const emit = (s: string, p: string, o: string) => {
    out.push(`${s} ${p} ${o} .`);
    triples += 1;
  };
  for (const n of nodes) {
    const s = N(n.id);
    emit(s, P("id"), lit(n.id));
    emit(s, P("text"), lit(n.text));
    emit(s, P("createdAt"), lit(n.createdAt));
    emit(s, P("updatedAt"), lit(n.updatedAt));
    const kids = n.children.filter((c) => known.has(c));
    for (const c of kids) emit(s, P("child"), N(c));
    if (kids.length > 0) emit(s, P("childrenOrdered"), lit(JSON.stringify(kids)));
    const mentioned = new Set<string>();
    for (const [fieldId, vs] of Object.entries(n.props)) {
      for (const pv of vs) {
        if (pv.t === "ref" && known.has(pv.v)) {
          emit(s, F(fieldId), N(pv.v));
          mentioned.add(pv.v);
        } else {
          emit(s, F(fieldId), lit(String(pv.v)));
        }
      }
    }
    MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_RE.exec(n.text)) !== null) {
      const t = m[1]!.trim();
      if (known.has(t)) mentioned.add(t);
    }
    for (const t of mentioned) emit(s, P("mentions"), N(t));
  }
  return { text: out.join("\n") + "\n", triples };
});

const store = new oxigraph.Store();
const load = await once(() => {
  store.load(ser.value.text, { format: "application/n-triples", no_transaction: true, lenient: true });
  return store.size;
});
notes.push(
  `triple count differs from the datom count by design: ":node/child-order" becomes one ordered literal instead of one datom per child. Bulk load uses store.load() with {no_transaction, lenient}; there is no quad-array fast path in the JS API, so the whole graph must be serialised to N-Triples first (${(ser.value.text.length / 1024 / 1024).toFixed(1)} MB of text at this scale)`,
);

gc();
const rssDeltaMB = +(rssMB() - rss0).toFixed(1);
const heapDeltaMB = +(heapMB() - heap0).toFixed(1);

const q = (sparql: string) => (store.query(sparql) as Map<string, unknown>[]).length;

const TYPE = F("sys.f.type");
const STATUS = F(FIELD_STATUS);
const EXTENDS = F("sys.f.onto.extends");

const Q1 = `SELECT ?id WHERE { ?n ${TYPE} ?t . ?t ${P("text")} "todo" . ?n ${P("id")} ?id }`;
const Q2 = `SELECT ?id WHERE { ?n ${TYPE} ?t . ?t ${P("text")} "todo" . ?n ${STATUS} "doing" . ?n ${P("id")} ?id }`;
const Q3 = `SELECT ?id WHERE { ?src ${P("mentions")} ${N(HUB)} . ?src ${P("id")} ?id }`;
// SPARQL 1.1 property path — the whole point of this candidate. `*` gives the
// zero-or-more case (a node tagged with the root itself) for free; datalog
// needs a second rule head for it.
const Q4 = `SELECT ?id WHERE { ?n ${TYPE} ?s . ?s ${EXTENDS}* ${N(TAG_ROOT)} . ?n ${P("id")} ?id }`;
const Q5 = `SELECT ?id WHERE { ${N(ORDERED_PARENT)} ${P("child")} ?c . ?c ${P("id")} ?id }`;
const Q6 = `SELECT ?v (COUNT(?n) AS ?c) WHERE { ?n ${STATUS} ?v } GROUP BY ?v`;
const CL = `SELECT ?id WHERE { ${N(CLOSURE_ROOT)} ${P("mentions")}+ ?n . ?n ${P("id")} ?id }`;
const PULL = `SELECT ?id ?text WHERE { ${N(ORDERED_PARENT)} ${P("child")} ?c . ?c ${P("id")} ?id . ?c ${P("text")} ?text }`;

const queries: Stat[] = [
  timeIt("Q1 all todos", RUNS, () => q(Q1)),
  timeIt("Q2 todos status=doing", RUNS, () => q(Q2)),
  timeIt("Q3 backlinks to hub", RUNS, () => q(Q3)),
  timeIt("Q4 tag inheritance", RUNS, () => q(Q4)),
  timeIt("Q5 children of parent", RUNS, () => q(Q5)),
  timeIt("Q6 count per status", RUNS, () => q(Q6)),
  timeIt("BL backlinks (=Q3)", RUNS, () => q(Q3)),
  timeIt("CL closure of mentions", RUNS, () => q(CL)),
  timeIt("PULL subtree", RUNS, () => q(PULL)),
];

// ---- incremental update -------------------------------------------------
const target = nodes[Math.floor(nodes.length / 2)]!;
let flip = 0;
const incrementalMs = timeIt("incremental upsert", RUNS, () => {
  const status = flip++ % 2 === 0 ? "doing" : "done";
  store.update(
    `DELETE { ${N(target.id)} ${STATUS} ?v } WHERE { ${N(target.id)} ${STATUS} ?v };
     INSERT DATA { ${N(target.id)} ${STATUS} ${lit(status)} }`,
  );
  return 1;
});

// ---- persistence: dump/reload is all the wasm build offers --------------
const persistence: Record<string, number | string> = {};
const dumped = await once(() => store.dump({ format: "application/n-quads" }));
persistence["dumpMs"] = dumped.ms;
persistence["dumpBytes"] = dumped.value.length;
const reload = await once(() => {
  const s2 = new oxigraph.Store();
  s2.load(dumped.value, { format: "application/n-quads", no_transaction: true, lenient: true });
  return s2.size;
});
persistence["reloadMs"] = reload.ms;
persistence["mode"] = "in-memory only (dump/load N-Triples)";
notes.push(
  "the npm `oxigraph` package exposes no on-disk store: the Store constructor takes only quads, and there is no open(path). RocksDB persistence exists in the Rust crate and the CLI/server, not in the wasm bindings — so 'RocksDB on native' is not reachable from Bun without writing our own napi/FFI binding",
);
const wasmBytes = (await Bun.file(new URL("./node_modules/oxigraph/node_bg.wasm", import.meta.url).pathname).stat()).size;
const webWasmBytes = (await Bun.file(new URL("./node_modules/oxigraph/web_bg.wasm", import.meta.url).pathname).stat()).size;
persistence["wasmBytesNode"] = wasmBytes;
persistence["wasmBytesWeb"] = webWasmBytes;

await writeResult({
  candidate: "oxigraph",
  scale,
  versions: { bun: Bun.version, oxigraph: "0.5.11" },
  nodes: nodes.length,
  datoms: ser.value.triples,
  coldLoadMs: {
    read: read.ms,
    jsonParse: parsed.ms,
    serialiseNTriples: ser.ms,
    storeLoad: load.ms,
    total: +(read.ms + parsed.ms + ser.ms + load.ms).toFixed(1),
  },
  rssDeltaMB,
  heapDeltaMB,
  queries,
  incrementalMs,
  persistence,
  notes,
});
