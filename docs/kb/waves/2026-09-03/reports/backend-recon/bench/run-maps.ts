/**
 * Candidate 4 — hand-rolled typed indexes ("own the 200 lines").
 *
 * Built straight from `KbNode`, skipping the datom expansion entirely:
 *
 *   byId       Map<NodeId, KbNode>                 the node store
 *   propIndex  Map<fieldId, Map<value, Set<NodeId>>>   AVET, for scalar props
 *   refIndex   Map<fieldId, Map<NodeId, Set<NodeId>>>  forward refs by field
 *   backrefs   Map<NodeId, Set<NodeId>>            VAET — every carrier unioned
 *   parentOf   Map<NodeId, NodeId>                 child -> parent
 *
 * The honest part of this measurement is not the query latency (it is a hash
 * lookup; of course it wins) but what the *code* costs: Q4 and CL are
 * hand-written traversals below, and that is the price of the option.
 *
 * Usage: bun run-maps.ts --scale 100k
 */
import { MENTION_RE, type KbNode, type NodeId } from "./lib/kb-datoms.ts";
import { gc, heapMB, once, rssMB, scaleArg, timeIt, writeResult, type Stat } from "./lib/bench.ts";
import { CLOSURE_ROOT, FIELD_STATUS, HUB, ORDERED_PARENT, TAG_ROOT } from "./lib/questions.ts";

const RUNS = 20;
const { file, scale } = scaleArg();
const FIELD_TYPE = "sys.f.type";
const FIELD_EXTENDS = "sys.f.onto.extends";

class MapIndex {
  readonly byId = new Map<NodeId, KbNode>();
  /** field id -> scalar value -> node ids (AVET) */
  readonly propIndex = new Map<string, Map<string | number | boolean, Set<NodeId>>>();
  /** field id -> target node -> source nodes (forward ref, per field) */
  readonly refIndex = new Map<string, Map<NodeId, Set<NodeId>>>();
  /** target -> every node referencing it by any carrier (VAET) */
  readonly backrefs = new Map<NodeId, Set<NodeId>>();
  /** target -> nodes referencing it specifically via `:node/mentions` semantics */
  readonly parentOf = new Map<NodeId, NodeId>();
  /** text index: lowercased text, for substring search */
  readonly lowerText = new Map<NodeId, string>();

  private bucket<K, V>(m: Map<K, Set<V>>, k: K): Set<V> {
    let s = m.get(k);
    if (!s) {
      s = new Set<V>();
      m.set(k, s);
    }
    return s;
  }

  rebuild(nodes: readonly KbNode[]) {
    for (const n of nodes) this.byId.set(n.id, n);
    for (const n of nodes) this.addNode(n);
  }

  addNode(n: KbNode) {
    this.lowerText.set(n.id, n.text.toLowerCase());
    for (const c of n.children) if (this.byId.has(c)) this.parentOf.set(c, n.id);
    for (const [fieldId, vs] of Object.entries(n.props)) {
      for (const pv of vs) {
        if (pv.t === "ref") {
          if (!this.byId.has(pv.v)) continue; // dangling ref: string sentinel, no join
          let fm = this.refIndex.get(fieldId);
          if (!fm) {
            fm = new Map();
            this.refIndex.set(fieldId, fm);
          }
          this.bucket(fm, pv.v).add(n.id);
          this.bucket(this.backrefs, pv.v).add(n.id);
        } else {
          let vm = this.propIndex.get(fieldId);
          if (!vm) {
            vm = new Map();
            this.propIndex.set(fieldId, vm);
          }
          this.bucket(vm, pv.v).add(n.id);
        }
      }
    }
    MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_RE.exec(n.text)) !== null) {
      const t = m[1]!.trim();
      if (this.byId.has(t)) this.bucket(this.backrefs, t).add(n.id);
    }
  }

  removeNode(n: KbNode) {
    for (const [fieldId, vs] of Object.entries(n.props)) {
      for (const pv of vs) {
        if (pv.t === "ref") {
          this.refIndex.get(fieldId)?.get(pv.v)?.delete(n.id);
          this.backrefs.get(pv.v)?.delete(n.id);
        } else {
          this.propIndex.get(fieldId)?.get(pv.v)?.delete(n.id);
        }
      }
    }
    MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_RE.exec(n.text)) !== null) this.backrefs.get(m[1]!.trim())?.delete(n.id);
    for (const c of n.children) if (this.parentOf.get(c) === n.id) this.parentOf.delete(c);
    this.lowerText.delete(n.id);
  }

  /** The incremental path: retract the old shape, add the new one. */
  upsert(next: KbNode) {
    const prev = this.byId.get(next.id);
    if (prev) this.removeNode(prev);
    this.byId.set(next.id, next);
    this.addNode(next);
  }

  // --- the eight questions, hand-written -------------------------------
  taggedWith(tagId: NodeId): Set<NodeId> {
    return this.refIndex.get(FIELD_TYPE)?.get(tagId) ?? new Set();
  }

  propEq(fieldId: string, v: string): Set<NodeId> {
    return this.propIndex.get(fieldId)?.get(v) ?? new Set();
  }

  /** Q4: nodes tagged with `tagId` or any tag transitively extending it. */
  taggedWithInherited(tagId: NodeId): NodeId[] {
    const out: NodeId[] = [];
    const tagFrontier: NodeId[] = [tagId];
    const seenTags = new Set<NodeId>([tagId]);
    const subtagsOf = this.refIndex.get(FIELD_EXTENDS);
    while (tagFrontier.length > 0) {
      const t = tagFrontier.pop()!;
      for (const n of this.taggedWith(t)) out.push(n);
      for (const sub of subtagsOf?.get(t) ?? []) {
        if (!seenTags.has(sub)) {
          seenTags.add(sub);
          tagFrontier.push(sub);
        }
      }
    }
    return out;
  }

  /** CL: transitive closure over the reference relation (BFS, not a fixpoint). */
  reachFrom(root: NodeId): NodeId[] {
    // Forward edges are not indexed by the maps above (backrefs is the reverse
    // index), so the forward walk reads the node itself — which is why the
    // forward adjacency has to be materialised once, below.
    const seen = new Set<NodeId>();
    const stack = [root];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const t of this.forward(cur)) {
        if (!seen.has(t)) {
          seen.add(t);
          stack.push(t);
        }
      }
    }
    return [...seen];
  }

  private fwd?: Map<NodeId, NodeId[]>;
  /** Forward reference adjacency, built lazily and cached. */
  forward(id: NodeId): readonly NodeId[] {
    if (!this.fwd) {
      this.fwd = new Map();
      for (const [target, sources] of this.backrefs) {
        for (const s of sources) {
          let arr = this.fwd.get(s);
          if (!arr) {
            arr = [];
            this.fwd.set(s, arr);
          }
          arr.push(target);
        }
      }
    }
    return this.fwd.get(id) ?? [];
  }

  countBy(fieldId: string): Map<string | number | boolean, number> {
    const out = new Map<string | number | boolean, number>();
    for (const [v, s] of this.propIndex.get(fieldId) ?? []) out.set(v, s.size);
    return out;
  }

  search(needle: string, limit: number): NodeId[] {
    const q = needle.toLowerCase();
    const out: NodeId[] = [];
    for (const [id, t] of this.lowerText) {
      if (t.includes(q)) {
        out.push(id);
        if (out.length >= limit) break;
      }
    }
    return out;
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
const idx = new MapIndex();
const build = await once(() => {
  idx.rebuild(nodes);
  return 1;
});
// Charge the forward-adjacency build to load, not to the closure query: an
// index that only answers "who points at X" cannot answer "what does X reach"
// without it, and pretending otherwise would flatter the closure row.
const fwdBuild = await once(() => {
  idx.forward(CLOSURE_ROOT);
  return 1;
});

gc();
const rssDeltaMB = +(rssMB() - rss0).toFixed(1);
const heapDeltaMB = +(heapMB() - heap0).toFixed(1);

// Datom count for the row header — the maps hold no datoms, so this is the
// equivalent datom count of the same graph, for comparability only.
const { nodesToDatoms } = await import("./lib/kb-datoms.ts");
const datomCount = nodesToDatoms(nodes).datoms.length;

const todoTag = "01KZFW1A5BT06QS7V6X6EBQMZ4";
const queries: Stat[] = [
  timeIt("Q1 all todos", RUNS, () => idx.taggedWith(todoTag).size),
  timeIt("Q2 todos status=doing", RUNS, () => {
    const todos = idx.taggedWith(todoTag);
    let n = 0;
    for (const id of idx.propEq(FIELD_STATUS, "doing")) if (todos.has(id)) n += 1;
    return n;
  }),
  timeIt("Q3 backlinks to hub", RUNS, () => (idx.backrefs.get(HUB) ?? new Set()).size),
  timeIt("Q4 tag inheritance", RUNS, () => idx.taggedWithInherited(TAG_ROOT).length),
  timeIt("Q5 children of parent", RUNS, () => idx.byId.get(ORDERED_PARENT)!.children.length),
  timeIt("Q6 count per status", RUNS, () => idx.countBy(FIELD_STATUS).size),
  timeIt("BL backlinks (=Q3)", RUNS, () => (idx.backrefs.get(HUB) ?? new Set()).size),
  timeIt("CL closure of mentions", RUNS, () => idx.reachFrom(CLOSURE_ROOT).length),
  timeIt("PULL subtree", RUNS, () => {
    const p = idx.byId.get(ORDERED_PARENT)!;
    return p.children.map((c) => idx.byId.get(c)!).length;
  }),
  timeIt("substring search 'ratchet'", RUNS, () => idx.search("ratchet", 50).length),
];

const target = nodes[Math.floor(nodes.length / 2)]!;
let flip = 0;
const incrementalMs = timeIt("incremental upsert", RUNS, () => {
  const status = flip++ % 2 === 0 ? "doing" : "done";
  idx.upsert({ ...target, props: { ...target.props, [FIELD_STATUS]: [{ t: "str", v: status }] } });
  return 1;
});

notes.push(
  "Q1/Q2/Q3/Q5/Q6 are one-line hash lookups; Q4 and CL are the 40 hand-written lines of traversal in this file, and they are the option's real cost",
);
notes.push(
  "Q2's intersection order is hand-chosen (status bucket driving, tag set probing). DataScript and SQLite pick a join order from statistics; here every new question is a new hand-optimised plan",
);
notes.push(
  "no persistence: these maps have no snapshot format, so cold start is always a full rebuild from JSONL",
);
notes.push(
  "`:node/mentions` unions both carriers as one relation, matching the builder — but the forward adjacency has to be materialised separately (charged to load above), because a reverse index alone cannot answer closure",
);

await writeResult({
  candidate: "typed-maps",
  scale,
  versions: { bun: Bun.version },
  nodes: nodes.length,
  datoms: datomCount,
  coldLoadMs: {
    read: read.ms,
    jsonParse: parsed.ms,
    buildMaps: build.ms,
    buildForwardAdjacency: fwdBuild.ms,
    total: +(read.ms + parsed.ms + build.ms + fwdBuild.ms).toFixed(1),
  },
  rssDeltaMB,
  heapDeltaMB,
  queries,
  incrementalMs,
  persistence: { mode: "none (rebuild only)" },
  notes,
});
