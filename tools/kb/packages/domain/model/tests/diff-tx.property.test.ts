/**
 * `diffTx` is the inverse of applying one: for any pair of node sets, the
 * transaction it reports, applied to the first, yields the second — and it
 * reports nothing at all when the two are the same graph. That second half is
 * what the watcher relies on as its double-fire guard, so it is a property,
 * not an example.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { canonicalJson, diffTx } from "../src/index.ts";
import type { KbNode } from "../src/index.ts";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, text: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

const setArb = fc
  .uniqueArray(
    fc.record({ id: fc.stringMatching(/^n[a-z]{1,4}$/), text: fc.string({ maxLength: 8 }) }),
    { selector: (n) => n.id, maxLength: 8 },
  )
  .map((ns) => ns.map(({ id, text }) => node(id, text)));

function applied(previous: KbNode[], tx: ReturnType<typeof diffTx>): KbNode[] {
  const next = new Map(previous.map((n) => [n.id, n]));
  for (const id of tx.deletes) next.delete(id);
  for (const n of tx.upserts) next.set(n.id, n);
  return [...next.values()].toSorted((a, b) => (a.id < b.id ? -1 : 1));
}

function sorted(nodes: KbNode[]): KbNode[] {
  return [...nodes].toSorted((a, b) => (a.id < b.id ? -1 : 1));
}

describe("diffTx", () => {
  test("applying the diff turns previous into next", () => {
    fc.assert(
      fc.property(setArb, setArb, (previous, next) => {
        expect(applied(previous, diffTx(previous, next))).toEqual(sorted(next));
      }),
    );
  });

  test("an unchanged node set diffs to nothing", () => {
    fc.assert(
      fc.property(setArb, (nodes) => {
        // A fresh structural copy, as a reload produces: equality is by value.
        const reloaded = nodes.map((n) => JSON.parse(canonicalJson(n)) as KbNode);
        expect(diffTx(nodes, reloaded)).toEqual({ upserts: [], deletes: [] });
      }),
    );
  });

  test("a changed node is an upsert, a dropped node is a delete", () => {
    const previous = [node("na", "old"), node("nb", "keep")];
    const next = [node("na", "new")];
    expect(diffTx(previous, next)).toEqual({ upserts: [node("na", "new")], deletes: ["nb"] });
  });
});
