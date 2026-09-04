/**
 * Synthetic kb graph generator.
 *
 * One generator, one file per scale; every candidate runner loads the same
 * JSONL. Shape is calibrated against the real `.kb/nodes.jsonl` (316 nodes,
 * 7.20 datoms/node measured 2026-09-04) and the real graph is embedded
 * verbatim as a subgraph, so every `sys.*` field/tag node the ontology and
 * render paths depend on is present.
 *
 * Deterministic: seeded PRNG, fixed fixture ids. Two runs produce byte-identical
 * files, so the numbers in the report are reproducible and cross-candidate rows
 * answer literally the same questions over literally the same graph.
 *
 * Usage: bun gen.ts --datoms 100000 --out data/100k.jsonl
 */
import { nodesToDatoms, type KbNode, type NodeId, type PropValue } from "./lib/kb-datoms.ts";

// ---------------------------------------------------------------- fixtures
// Stable across scales so latency rows compare like-for-like: the backlink
// target has the same in-degree and the closure component the same size at
// 100 k datoms as at 1 M.
export const FIX = {
  /** backlinks target — mentioned by exactly BACKLINK_FANIN nodes */
  hub: "01N0HUB0000000000000000000",
  /** root of a binary `:node/mentions` tree of depth CLOSURE_DEPTH */
  closureRoot: "01N0CLOSURE000000000000000",
  /** parent carrying PARENT_FANOUT ordered children */
  orderedParent: "01N0PARENT0000000000000000",
  /** root of the tag `extends` chain that Q4 walks */
  tagRoot: "01N0TAGROOT000000000000000",
  tagMid: "01N0TAGMID0000000000000000",
  tagLeaf: "01N0TAGLEAF000000000000000",
  /** a node whose subtree Q7 pulls */
  pullRoot: "01N0PARENT0000000000000000",
} as const;

export const BACKLINK_FANIN = 500;
export const CLOSURE_DEPTH = 11; // 2^11 - 1 = 2047 nodes in the component
export const PARENT_FANOUT = 36; // matches the real graph's widest node

/** Real field/tag node ids reused so queries hit the same attrs as production. */
export const REAL = {
  fieldStatus: "01KZFW1A581GP25YPYRF614BAZ",
  fieldParent: "01M0YM7VATM1QX8Z6KH7NEAP69",
  tagTodo: "01KZFW1A5BT06QS7V6X6EBQMZ4",
  fieldExtends: "sys.f.onto.extends",
  fieldType: "sys.f.type",
  fieldFields: "sys.f.fields",
  sysTag: "sys.tag",
  sysField: "sys.field",
} as const;

export const STATUSES = ["doing", "done", "todo", "parked", "blocked", "review"] as const;

// ------------------------------------------------------------------ PRNG
/** mulberry32 — small, fast, and deterministic across Bun versions. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Monotonic ULID-shaped id: sorts by mint order, like real ULIDs do. */
function mintId(seq: number): NodeId {
  let s = "";
  let n = seq;
  for (let i = 0; i < 13; i++) {
    s = B32[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return `01N1${s.padStart(22, "0")}`;
}

const WORDS =
  "index datom node graph query cache commit store rebuild lint ratchet gate wave brief recon effect schema surface action receipt render ontology closure mention backlink field tag prop value scope harness snapshot fixture drift seam adapter port latency memory bundle browser tailnet outliner canvas lens".split(
    " ",
  );

function text(r: () => number, len: number): string {
  let s = "";
  while (s.length < len) s += (s ? " " : "") + WORDS[Math.floor(r() * WORDS.length)];
  return s.slice(0, len);
}

/** Real graph's text length distribution: p50 43, p90 134, max 366. */
function textLen(r: () => number): number {
  const u = r();
  if (u < 0.5) return 12 + Math.floor(r() * 50);
  if (u < 0.9) return 62 + Math.floor(r() * 80);
  return 142 + Math.floor(r() * 224);
}

/** Real graph's children fan-out: 280/316 leaves, a long thin tail to 36. */
function fanout(r: () => number): number {
  const u = r();
  if (u < 0.886) return 0;
  if (u < 0.905) return 1;
  if (u < 0.933) return 2;
  if (u < 0.949) return 3;
  if (u < 0.971) return 4;
  if (u < 0.981) return 5;
  if (u < 0.987) return 6;
  return 8;
}

const ISO_BASE = Date.parse("2026-01-01T00:00:00.000Z");
function iso(seq: number): string {
  return new Date(ISO_BASE + seq * 1000).toISOString();
}

/** Exact datom contribution of one node, by the rules in lib/kb-datoms.ts. */
function datomCost(n: KbNode, exists: (id: NodeId) => boolean): number {
  let c = 0;
  for (const ch of n.children) if (exists(ch)) c += 1;
  let props = 0;
  const mentioned = new Set<NodeId>();
  for (const vs of Object.values(n.props)) {
    for (const pv of vs) {
      props += 1;
      if (pv.t === "ref" && exists(pv.v)) mentioned.add(pv.v);
    }
  }
  const MR = /\[\[([^[\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = MR.exec(n.text)) !== null) if (exists(m[1]!.trim())) mentioned.add(m[1]!.trim());
  return 4 + 2 * c + (c > 0 ? 1 : 0) + props + mentioned.size;
}

function ref(v: NodeId): PropValue[] {
  return [{ t: "ref", v }];
}
function str(v: string): PropValue[] {
  return [{ t: "str", v }];
}

export async function generate(targetDatoms: number, realJsonlPath: string) {
  const r = rng(0x6b625f31);
  const seedText = await Bun.file(realJsonlPath).text();
  const seed: KbNode[] = seedText
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as KbNode);

  const nodes: KbNode[] = [...seed];
  const ids = new Set(nodes.map((n) => n.id));
  const exists = (id: NodeId) => ids.has(id);
  const push = (n: KbNode) => {
    nodes.push(n);
    ids.add(n.id);
  };

  let seq = 0;
  const next = () => mintId(seq++);

  // -- synthetic tag hierarchy: root <- mid <- leaf, exercised by Q4 --------
  const mk = (id: NodeId, t: string, props: Record<string, PropValue[]>, children: NodeId[] = []): KbNode => ({
    id,
    text: t,
    createdAt: iso(seq),
    updatedAt: iso(seq),
    children,
    props,
  });

  push(mk(FIX.tagRoot, "bench-root", { [REAL.fieldType]: ref(REAL.sysTag), [REAL.fieldFields]: ref(REAL.fieldStatus) }));
  push(mk(FIX.tagMid, "bench-mid", { [REAL.fieldType]: ref(REAL.sysTag), [REAL.fieldExtends]: ref(FIX.tagRoot) }));
  push(mk(FIX.tagLeaf, "bench-leaf", { [REAL.fieldType]: ref(REAL.sysTag), [REAL.fieldExtends]: ref(FIX.tagMid) }));

  // -- closure component: binary mention tree, identical at every scale -----
  // Built top-down; each parent's text carries [[child]] tokens, so the
  // component exercises the *text* mention carrier, not just ref props.
  const closureIds: NodeId[] = [FIX.closureRoot];
  const total = 2 ** CLOSURE_DEPTH - 1;
  for (let i = 1; i < total; i++) closureIds.push(next());
  for (let i = 0; i < total; i++) {
    const l = 2 * i + 1;
    const rr = 2 * i + 2;
    const kids = [l, rr].filter((k) => k < total).map((k) => closureIds[k]!);
    const body = text(r, textLen(r));
    push(
      mk(closureIds[i]!, kids.length ? `${body} ${kids.map((k) => `[[${k}]]`).join(" ")}` : body, {
        [REAL.fieldType]: ref(FIX.tagLeaf),
        [REAL.fieldStatus]: str(STATUSES[i % STATUSES.length]!),
      }),
    );
  }

  // -- backlink hub: BACKLINK_FANIN sources, half text / half ref-prop ------
  push(mk(FIX.hub, "bench backlink hub", { [REAL.fieldType]: ref(FIX.tagMid) }));
  for (let i = 0; i < BACKLINK_FANIN; i++) {
    const id = next();
    const viaText = i % 2 === 0;
    push(
      mk(id, viaText ? `${text(r, textLen(r))} [[${FIX.hub}]]` : text(r, textLen(r)), {
        [REAL.fieldType]: ref(REAL.tagTodo),
        [REAL.fieldStatus]: str(STATUSES[i % STATUSES.length]!),
        ...(viaText ? {} : { [REAL.fieldParent]: ref(FIX.hub) }),
      }),
    );
  }

  // -- ordered-children fixture -------------------------------------------
  const kidIds: NodeId[] = [];
  for (let i = 0; i < PARENT_FANOUT; i++) kidIds.push(next());
  push(mk(FIX.orderedParent, "bench ordered parent", { [REAL.fieldType]: ref(REAL.tagTodo) }, kidIds));
  for (let i = 0; i < PARENT_FANOUT; i++) {
    push(mk(kidIds[i]!, `child ${i} ${text(r, 20)}`, { [REAL.fieldStatus]: str(STATUSES[i % STATUSES.length]!) }));
  }

  // -- bulk fill up to the datom budget -----------------------------------
  let datoms = 0;
  for (const n of nodes) datoms += datomCost(n, exists);

  const bulkStart = nodes.length;
  const pendingParents: { node: KbNode; want: number }[] = [];
  while (datoms < targetDatoms) {
    const id = next();
    const tagPick = r();
    const tag = tagPick < 0.45 ? REAL.tagTodo : tagPick < 0.7 ? FIX.tagLeaf : tagPick < 0.85 ? FIX.tagMid : FIX.tagRoot;
    const props: Record<string, PropValue[]> = {
      [REAL.fieldType]: ref(tag),
      [REAL.fieldStatus]: str(STATUSES[Math.floor(r() * STATUSES.length)]!),
    };
    // ~25% carry a ref-typed prop at an earlier node (the ref-prop mention
    // carrier); ~8% carry a [[…]] token in text (the text carrier).
    let body = text(r, textLen(r));
    if (r() < 0.25 && nodes.length > bulkStart + 2) {
      props[REAL.fieldParent] = ref(nodes[bulkStart + Math.floor(r() * (nodes.length - bulkStart))]!.id);
    }
    if (r() < 0.08 && nodes.length > bulkStart + 2) {
      body += ` [[${nodes[bulkStart + Math.floor(r() * (nodes.length - bulkStart))]!.id}]]`;
    }
    const n = mk(id, body, props);
    const want = fanout(r);
    // Children are filled by the *next* generated nodes, so the bulk region is
    // a forest of the same shape as the real graph rather than a flat list.
    if (want > 0) pendingParents.push({ node: n, want });
    else {
      const p = pendingParents[0];
      if (p) {
        p.node.children.push(id);
        if (p.node.children.length >= p.want) {
          pendingParents.shift();
          datoms += 2 * p.node.children.length + 1;
        }
      }
    }
    push(n);
    datoms += datomCost(n, exists);
  }
  // parents that never filled up still cost their placed children
  for (const p of pendingParents) if (p.node.children.length) datoms += 2 * p.node.children.length + 1;

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return nodes;
}

/** Canonical JSON: recursively sorted keys, matching the store's own writer. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

if (import.meta.main) {
  const argv = Bun.argv;
  const target = Number(argv[argv.indexOf("--datoms") + 1]);
  const out = argv[argv.indexOf("--out") + 1]!;
  const real = argv.includes("--real")
    ? argv[argv.indexOf("--real") + 1]!
    : new URL("../../../../../../.kb/nodes.jsonl", import.meta.url).pathname;

  const nodes = await generate(target, real);
  const { datoms } = nodesToDatoms(nodes);
  const lines = nodes.map((n) => canonical(n)).join("\n") + "\n";
  await Bun.write(out, lines);
  console.log(
    JSON.stringify({
      out,
      nodes: nodes.length,
      datoms: datoms.length,
      datomsPerNode: +(datoms.length / nodes.length).toFixed(2),
      bytes: lines.length,
      targetDatoms: target,
    }),
  );
}
