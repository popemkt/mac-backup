import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { canonicalJsonl } from "../src/canonical.ts";
import { mergeNodeSets } from "../src/merge.ts";
import type { KbNode } from "../src/model.ts";
import { compareRootOrder, ranksFor } from "../src/order.ts";
import { present } from "../src/present.ts";

const AT = "2026-09-26T13:51:00.000Z";
const LATER = "2026-09-26T14:51:00.000Z";
const ids = ["a", "b", "c", "d"];
const orders = ranksFor(ids);
const base: KbNode[] = ids.map((id) => ({
  id,
  text: id,
  order: orders.get(id),
  props: {},
  children: [],
  createdAt: AT,
  updatedAt: AT,
}));

function ranked(nodes: readonly KbNode[]): string[] {
  return [...nodes].toSorted(compareRootOrder).map((n) => n.id);
}

describe("merge position and content properties (fast-check)", () => {
  test("a position changed on only one side survives the other side's content edit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), fc.boolean(), (index, swapSides) => {
        const positioned = base.map((n) => (n.id === ids[index] ? { ...n, order: "z" } : n));
        const edited = base.map((n) =>
          n.id === ids[index] ? { ...n, text: "edited", updatedAt: LATER } : n,
        );
        const result = mergeNodeSets(
          base,
          swapSides ? edited : positioned,
          swapSides ? positioned : edited,
        );
        expect(result.conflicts).toEqual([]);
        expect(result.nodes[index]?.order).toBe("z");
      }),
    );
  });

  test("content changed on only one side survives the other side's position edit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.string(), (index, text) => {
        const positioned = base.map((n) =>
          n.id === ids[index] ? { ...n, order: "z", updatedAt: "2026-09-26T15:51:00.000Z" } : n,
        );
        const edited = base.map((n) =>
          n.id === ids[index] ? { ...n, text, updatedAt: LATER } : n,
        );
        const result = mergeNodeSets(base, positioned, edited);
        expect(result.conflicts).toEqual([]);
        expect(result.nodes[index]?.text).toBe(text);
      }),
    );
  });

  test("siblings keep their relative order when neither side moves them", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.string(), (index, text) => {
        const respread = base.map((n, place) => ({
          ...n,
          order: ["zkk", "zpp", "zuu", "zxx"][place],
        }));
        const stale = base.map((n) => ({ ...n, order: "zzzzzzzzzyhhhhhhhhhhhhhhhhhhhh" }));
        const edited = stale.map((n) =>
          n.id === ids[index] ? { ...n, text, updatedAt: LATER } : n,
        );
        const result = mergeNodeSets(stale, respread, edited);
        expect(result.conflicts).toEqual([]);
        expect(ranked(result.nodes)).toEqual(ids);
        expect(result.nodes.map((n) => n.order)).toEqual(respread.map((n) => n.order));
      }),
    );
  });

  test("swapping sides preserves the outcome when no tie-break is needed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.string(), (index, text) => {
        const positioned = base.map((n) => (n.id === ids[index] ? { ...n, order: "z" } : n));
        const edited = base.map((n) => (n.id === ids[index] ? { ...n, text } : n));
        const forward = mergeNodeSets(base, positioned, edited);
        const reverse = mergeNodeSets(base, edited, positioned);
        expect(forward.conflicts).toEqual([]);
        expect(reverse.conflicts).toEqual([]);
        expect(canonicalJsonl(forward.nodes)).toBe(canonicalJsonl(reverse.nodes));
      }),
    );
  });

  test("a kept child is never orphaned by a conflicting deletion", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        fc.boolean(),
        (index, editParent, swapSides) => {
          const selectedId = present(ids[index], "selected child id");
          const parent = { ...present(base[0], "first base node"), id: "parent", children: ids };
          const before = [parent, ...base];
          const retained = [
            editParent ? { ...parent, text: "edited parent", updatedAt: LATER } : parent,
            ...base.map((n) =>
              n.id === selectedId ? { ...n, text: "edited child", updatedAt: LATER } : n,
            ),
          ];
          const deleted = [
            { ...parent, children: ids.filter((id) => id !== selectedId) },
            ...base.filter((n) => n.id !== selectedId),
          ];
          const merged = mergeNodeSets(
            before,
            swapSides ? deleted : retained,
            swapSides ? retained : deleted,
          );
          expect(merged.conflicts).toEqual([{ id: selectedId, reason: "deleted-and-modified" }]);
          expect(merged.nodes.find((n) => n.id === selectedId)?.text).toBe("edited child");
          expect(merged.nodes.find((n) => n.id === "parent")?.children).toEqual(ids);
        },
      ),
    );
  });
});
