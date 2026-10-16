/**
 * The cost of planning an outline, counted rather than timed, so it cannot
 * be mistaken however loaded the machine is.
 *
 * - At the forest roots, every read of a stored root's rank is counted: a
 *   plan that sorts the roots for each top-level item reads about 2·R·log₂R
 *   ranks an item, and one that searches them about log₂R.
 * - Under one parent, every read the plan makes of the graph is counted, and
 *   a sibling group handed back whole counts as one read per member: a plan
 *   that reads the parent's whole group, or rewrites the parent, for each
 *   child it files costs about k an item, and one that files in place a
 *   constant.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { IndexedNodes, type KbNode, type NodeGraph, type Slots } from "@kb/model";
import { planNodeAddTreeEffect } from "../src/node-add-tree.ts";

const ROOTS = 5000;

/**
 * `count` roots with well-formed ascending ranks (fixed width, as a commit
 * leaves them), whose `order` counts its reads into `reads`.
 */
function countedRoots(count: number, reads: { n: number }): KbNode[] {
  const out: KbNode[] = [];
  for (let i = 0; i < count; i++) {
    const order = `${i.toString(36).padStart(4, "0")}5`;
    const node: KbNode = {
      id: `r${i}`,
      text: `r${i}`,
      props: {},
      children: [],
      createdAt: "",
      updatedAt: "",
    };
    Object.defineProperty(node, "order", {
      enumerable: true,
      get: () => {
        reads.n++;
        return order;
      },
    });
    out.push(node);
  }
  return out;
}

/** Root-rank reads per top-level item, planning `items` of them over `ROOTS` stored roots. */
function readsPerItem(items: number): number {
  const reads = { n: 0 };
  const graph = IndexedNodes.of(countedRoots(ROOTS, reads));
  graph.slots(null); // the one ordering, as the first placement would make it
  reads.n = 0;
  const outline = Array.from({ length: items }, (_, i) => `- top ${i}`).join("\n");
  const plan = Effect.runSync(planNodeAddTreeEffect({ outline }, graph));
  expect(plan.ids).toHaveLength(items);
  return reads.n / items;
}

describe("planning an outline at the forest roots", () => {
  test("costs a search of the roots per top-level item, never a sort", () => {
    const bound = 4 * Math.log2(ROOTS) + 16;
    const few = readsPerItem(10);
    const many = readsPerItem(1000);
    expect(few).toBeLessThan(bound);
    expect(many).toBeLessThan(bound);
  });
});

/** `inner`, counting every read a plan makes and every write, by kind. */
function counting(inner: NodeGraph) {
  const work = { reads: 0, puts: 0, files: 0 };
  const view = <N>(slots: Slots<N>): Slots<N> => {
    // A group handed back whole was built whole: one read per member.
    if (Array.isArray(slots)) work.reads += slots.length;
    return {
      get length() {
        return slots.length;
      },
      at: (i) => {
        work.reads++;
        return slots.at(i);
      },
    };
  };
  const graph: NodeGraph = {
    get: (id) => (work.reads++, inner.get(id)),
    has: (id) => (work.reads++, inner.has(id)),
    typedNamed: (typeId, text) => {
      const found = inner.typedNamed(typeId, text);
      work.reads += 1 + found.length;
      return found;
    },
    parentOf: (id) => (work.reads++, inner.parentOf(id)),
    slots: (parent, excluding) => view(inner.slots(parent, excluding)),
    values: () => inner.values(),
    put: (node) => {
      work.puts++;
      inner.put(node);
    },
    insertChild: (parent, child, position, at) => {
      work.files++;
      inner.insertChild(parent, child, position, at);
    },
  };
  return { graph, work };
}

/** Planning `items` children under one stored parent, among `ROOTS` other nodes. */
function underOneParent(items: number) {
  const store: KbNode[] = Array.from({ length: ROOTS }, (_, i) => ({
    id: `s${i}`,
    text: `s${i}`,
    props: {},
    children: [],
    createdAt: "",
    updatedAt: "",
    order: `${i.toString(36).padStart(4, "0")}5`,
  }));
  const { graph, work } = counting(IndexedNodes.of(store));
  const outline = Array.from({ length: items }, (_, i) => `- child ${i}`).join("\n");
  const plan = Effect.runSync(planNodeAddTreeEffect({ outline, parent: "s0" }, graph));
  expect(plan.ids).toHaveLength(items);
  expect(plan.upserts.find((n) => n.id === "s0")?.children).toEqual(plan.ids);
  return { readsPerItem: work.reads / items, puts: work.puts, files: work.files };
}

describe("planning an outline under one parent", () => {
  // Up to about 400 children: past that, a run of appends grows its ranks past
  // the 12 characters a rank may use (`rankBetween` steps the tail), and each
  // placement scans back for a usable neighbour until the commit re-spreads
  // the group — the cost DESIGN.md → The plan graph names as left.
  test("files each child in place: a constant number of reads per item, and no parent rewrite", () => {
    for (const items of [10, 350]) {
      const cost = underOneParent(items);
      expect(cost.readsPerItem).toBeLessThan(12);
      expect(cost.puts).toBe(items);
      expect(cost.files).toBe(items);
    }
  });
});
