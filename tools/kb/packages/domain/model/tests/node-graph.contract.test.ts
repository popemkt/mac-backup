/**
 * The `NodeGraph` contract, run over every implementation: whatever sequence
 * of writes a plan makes into a well-formed graph (a forest after every
 * write, dangling child ids allowed) — renames, retags, re-ranks, moves,
 * additions by `put` or by `insertChild`, a dangling child coming to exist —
 * each one answers every question exactly as a naive reading of the current
 * node set does: `get`, `has`, `typedNamed`, `parentOf`, `slots` for every
 * group (the roots in visible order) with and without an excluded member,
 * `resolveFieldIn` / `resolveTagIn`, and `siblingSlots` over its `values()`.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type KbNode, type NodeId } from "../src/model.ts";
import { IndexedNodes, ScannedNodes, type NodeGraph } from "../src/node-graph.ts";
import { compareRootOrder, siblingSlots, type Slots } from "../src/order.ts";
import { ResolveError, resolveFieldIn, resolveTagIn } from "../src/resolve.ts";

const IMPLEMENTATIONS: Record<string, (nodes: readonly KbNode[]) => NodeGraph> = {
  ScannedNodes: (nodes) => new ScannedNodes(nodes),
  IndexedNodes: (nodes) => IndexedNodes.of(nodes),
};

type Kind = "plain" | "field" | "tag";
const TEXTS = ["a", "b", "c"] as const;
const RANKS = [undefined, "b", "h", "h", "q"] as const;

function propsOf(kind: Kind): KbNode["props"] {
  if (kind === "plain") return {};
  const type = kind === "field" ? SYSTEM_IDS.field : SYSTEM_IDS.tag;
  return { [SYSTEM_IDS.typeField]: [{ t: "ref", v: type }] };
}

function makeNode(id: NodeId, text: string, kind: Kind, order: string | undefined): KbNode {
  return {
    id,
    text,
    props: propsOf(kind),
    children: [],
    createdAt: "",
    updatedAt: "",
    ...(order === undefined ? {} : { order }),
  };
}

const kindArb = fc.constantFrom<Kind>("plain", "field", "tag");
const nodeSpecArb = fc.record({
  text: fc.constantFrom(...TEXTS),
  kind: kindArb,
  order: fc.constantFrom(...RANKS),
  /** A fraction picking a parent among the earlier nodes, or none. */
  parent: fc.option(fc.double({ min: 0, max: 0.999, noNaN: true }), { nil: undefined }),
  /** Whether the node also lists a child id that names no node. */
  ghost: fc.boolean(),
});

type Op =
  | { op: "rename"; at: number; text: string }
  | { op: "retag"; at: number; kind: Kind }
  | { op: "rerank"; at: number; order: string | undefined }
  | { op: "move"; at: number; to: number | null; index: number }
  | { op: "add"; text: string; kind: Kind; order: string | undefined; to: number | null }
  | { op: "file"; text: string; kind: Kind; order: string | undefined; to: number; index: number }
  | { op: "unghost"; at: number; text: string; kind: Kind };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("rename" as const), at: fc.nat(), text: fc.constantFrom(...TEXTS) }),
  fc.record({ op: fc.constant("retag" as const), at: fc.nat(), kind: kindArb }),
  fc.record({ op: fc.constant("rerank" as const), at: fc.nat(), order: fc.constantFrom(...RANKS) }),
  fc.record({
    op: fc.constant("move" as const),
    at: fc.nat(),
    to: fc.option(fc.nat(), { nil: null }),
    index: fc.nat({ max: 4 }),
  }),
  fc.record({
    op: fc.constant("add" as const),
    text: fc.constantFrom(...TEXTS),
    kind: kindArb,
    order: fc.constantFrom(...RANKS),
    to: fc.option(fc.nat(), { nil: null }),
  }),
  fc.record({
    op: fc.constant("file" as const),
    text: fc.constantFrom(...TEXTS),
    kind: kindArb,
    order: fc.constantFrom(...RANKS),
    to: fc.nat(),
    index: fc.nat({ max: 6 }),
  }),
  fc.record({
    op: fc.constant("unghost" as const),
    at: fc.nat(),
    text: fc.constantFrom(...TEXTS),
    kind: kindArb,
  }),
);

type NodeSpec = typeof nodeSpecArb extends fc.Arbitrary<infer T> ? T : never;

function initialForest(specs: readonly NodeSpec[]): KbNode[] {
  const nodes = specs.map((spec, i) => makeNode(`n${i}`, spec.text, spec.kind, spec.order));
  specs.forEach((spec, i) => {
    if (spec.ghost) {
      const self = nodes[i];
      if (self !== undefined) nodes[i] = { ...self, children: [...self.children, `g${i}`] };
    }
    if (spec.parent === undefined || i === 0) return;
    const parent = nodes[Math.floor(spec.parent * i)];
    if (parent !== undefined)
      nodes[nodes.indexOf(parent)] = { ...parent, children: [...parent.children, `n${i}`] };
  });
  return nodes;
}

/** The naive reading every implementation must agree with. */
class Oracle {
  readonly nodes = new Map<NodeId, KbNode>();
  constructor(nodes: readonly KbNode[]) {
    for (const n of nodes) this.nodes.set(n.id, n);
  }
  apply(write: Write): void {
    if ("put" in write) {
      this.nodes.set(write.put.id, write.put);
      return;
    }
    const { parent, child, position, at } = write.file;
    const node = this.nodes.get(parent);
    if (node === undefined) return;
    const children = [...node.children];
    children.splice(Math.min(position, children.length), 0, child);
    this.nodes.set(parent, { ...node, children, updatedAt: at });
  }
  /** Child ids some node lists that name no node. */
  ghosts(): NodeId[] {
    return this.all().flatMap((n) => n.children.filter((c) => !this.nodes.has(c)));
  }
  all(): KbNode[] {
    return [...this.nodes.values()];
  }
  parentOf(id: NodeId): NodeId | undefined {
    return this.all().find((n) => n.children.includes(id))?.id;
  }
  roots(): KbNode[] {
    return this.all()
      .filter((n) => this.parentOf(n.id) === undefined)
      .toSorted(compareRootOrder);
  }
  slots(parent: NodeId | null, excluding: NodeId | undefined): NodeId[] {
    const group =
      parent === null
        ? this.roots()
        : (this.nodes.get(parent)?.children ?? []).flatMap((id) => this.nodes.get(id) ?? []);
    return group.map((n) => n.id).filter((id) => id !== excluding);
  }
  isUnder(id: NodeId, ancestor: NodeId): boolean {
    for (let at: NodeId | undefined = id; at !== undefined; at = this.parentOf(at)) {
      if (at === ancestor) return true;
    }
    return false;
  }
  /** The id a name resolves to, or the failure code. */
  resolve(kind: "field" | "tag", name: string): string {
    if (this.nodes.has(name)) return name;
    const type = kind === "field" ? SYSTEM_IDS.field : SYSTEM_IDS.tag;
    const matches = this.all().filter(
      (n) => n.text === name && (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.v === type),
    );
    if (matches.length === 1) return matches[0]?.id ?? "";
    return matches.length === 0 ? "not_found" : "ambiguous";
  }
}

type Write =
  | { put: KbNode }
  | { file: { parent: NodeId; child: NodeId; position: number; at: string } };

/** The writes one op makes, in the order a plan makes them; none when the op does not apply. */
function writesOf(op: Op, oracle: Oracle, fresh: () => NodeId): Write[] {
  const ids = [...oracle.nodes.keys()];
  const pick = (n: number): KbNode | undefined => oracle.nodes.get(ids[n % ids.length] ?? "");
  if (op.op === "add") {
    const node = makeNode(fresh(), op.text, op.kind, op.order);
    const parent = op.to === null ? undefined : pick(op.to);
    return parent === undefined
      ? [{ put: node }]
      : [{ put: node }, { put: { ...parent, children: [...parent.children, node.id] } }];
  }
  if (op.op === "file") {
    const parent = pick(op.to);
    if (parent === undefined) return [];
    const node = makeNode(fresh(), op.text, op.kind, op.order);
    const file = { parent: parent.id, child: node.id, position: op.index, at: `t${op.index}` };
    return [{ file }, { put: node }];
  }
  if (op.op === "unghost") {
    const ghosts = oracle.ghosts();
    const ghost = ghosts[op.at % Math.max(1, ghosts.length)];
    return ghost === undefined ? [] : [{ put: makeNode(ghost, op.text, op.kind, undefined) }];
  }
  const node = pick(op.at);
  if (node === undefined) return [];
  if (op.op === "rename") return [{ put: { ...node, text: op.text } }];
  if (op.op === "retag") return [{ put: { ...node, props: propsOf(op.kind) } }];
  if (op.op === "rerank") {
    const { order: _drop, ...rest } = node;
    return [{ put: op.order === undefined ? rest : { ...rest, order: op.order } }];
  }
  return moveWrites(op, node, oracle, pick);
}

/** A move's writes: the old parent without the node, then the new one with it. */
function moveWrites(
  op: Extract<Op, { op: "move" }>,
  node: KbNode,
  oracle: Oracle,
  pick: (n: number) => KbNode | undefined,
): Write[] {
  const target = op.to === null ? undefined : pick(op.to);
  if (target !== undefined && oracle.isUnder(target.id, node.id)) return [];
  const from = oracle.parentOf(node.id);
  const puts: KbNode[] = [];
  if (from !== undefined) {
    const old = oracle.nodes.get(from);
    if (old !== undefined)
      puts.push({ ...old, children: old.children.filter((c) => c !== node.id) });
  }
  if (target !== undefined) {
    const latest = puts.find((p) => p.id === target.id) ?? target;
    const children = latest.children.filter((c) => c !== node.id);
    children.splice(Math.min(op.index, children.length), 0, node.id);
    const moved = { ...latest, children };
    const i = puts.findIndex((p) => p.id === moved.id);
    if (i >= 0) puts[i] = moved;
    else puts.push(moved);
  }
  return puts.map((put) => ({ put }));
}

const listed = <N>(slots: Slots<N>): N[] =>
  Array.from({ length: slots.length }, (_, i) => slots.at(i)).flatMap((n) =>
    n === undefined ? [] : [n],
  );

function outcome(f: () => NodeId): string {
  try {
    return f();
  } catch (err) {
    if (err instanceof ResolveError) return err.code;
    throw err;
  }
}

function agrees(graph: NodeGraph, oracle: Oracle): void {
  const ids = [...oracle.nodes.keys()];
  for (const id of [...ids, ...oracle.ghosts(), "missing"]) {
    expect(graph.get(id)).toEqual(oracle.nodes.get(id));
    expect(graph.has(id)).toBe(oracle.nodes.has(id));
    expect(graph.parentOf(id)).toBe(oracle.parentOf(id));
  }
  for (const typeId of [SYSTEM_IDS.field, SYSTEM_IDS.tag]) {
    for (const text of TEXTS) {
      const expected = oracle
        .all()
        .filter(
          (n) =>
            n.text === text && (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.v === typeId),
        )
        .map((n) => n.id)
        .toSorted();
      expect(
        graph
          .typedNamed(typeId, text)
          .map((n) => n.id)
          .toSorted(),
      ).toEqual(expected);
    }
  }
  const values = [...graph.values()];
  for (const parent of [null, ...ids]) {
    for (const excluding of [undefined, ...ids.slice(0, 4), "missing"]) {
      const expected = oracle.slots(parent, excluding);
      const slots = graph.slots(parent, excluding);
      expect(listed(slots).map((n) => n.id)).toEqual(expected);
      expect(slots.length).toBe(expected.length);
      expect(listed(slots)).toEqual(expected.flatMap((id) => oracle.nodes.get(id) ?? []));
      expect(siblingSlots(values, parent, excluding).map((n) => n.id)).toEqual(expected);
    }
  }
  for (const name of [...TEXTS, ...ids.slice(0, 3), "nope"]) {
    expect(outcome(() => resolveFieldIn(graph, name))).toBe(oracle.resolve("field", name));
    expect(outcome(() => resolveTagIn(graph, name))).toBe(oracle.resolve("tag", name));
  }
}

for (const [name, make] of Object.entries(IMPLEMENTATIONS)) {
  describe(`NodeGraph contract: ${name}`, () => {
    test("answers like a naive reading of its nodes after any sequence of puts", () => {
      fc.assert(
        fc.property(
          fc.array(nodeSpecArb, { minLength: 1, maxLength: 16 }),
          fc.array(opArb, { maxLength: 20 }),
          fc.boolean(),
          (specs, ops, askEarly) => {
            const nodes = initialForest(specs);
            const graph = make(nodes);
            const oracle = new Oracle(nodes);
            if (askEarly) agrees(graph, oracle);
            let next = nodes.length;
            for (const op of ops) {
              for (const write of writesOf(op, oracle, () => `n${next++}`)) {
                if ("put" in write) graph.put(write.put);
                else {
                  const { parent, child, position, at } = write.file;
                  graph.insertChild(parent, child, position, at);
                }
                oracle.apply(write);
              }
              if (askEarly) agrees(graph, oracle);
            }
            agrees(graph, oracle);
          },
        ),
        { numRuns: 300 },
      );
    });

    test("never writes the array it was built from", () => {
      const nodes = [makeNode("a", "a", "plain", "b")];
      const graph = make(nodes);
      graph.put(makeNode("b", "b", "plain", "h"));
      expect(nodes.map((n) => n.id)).toEqual(["a"]);
    });
  });
}
