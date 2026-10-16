/**
 * The cost of planning an outline at the forest roots, counted rather than
 * timed: every read of a stored root's rank is counted, so a plan that sorts
 * the roots for each top-level item (about 2·R·log₂R reads an item) and one
 * that searches them (about log₂R) cannot be mistaken for each other, however
 * loaded the machine is.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { IndexedNodes, type KbNode } from "@kb/model";
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
  graph.roots(); // the one ordering, as the first placement would make it
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
