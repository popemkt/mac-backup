/**
 * The dockview adapter: kb's layout tree is canonical, so projecting it to
 * dockview's serialized form and reading that back is the identity.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Orientation } from "dockview-react";
import { Result } from "effect";
import { decodeLayout, type LayoutTree } from "@kb/views";
import { fromDockview, toDockview } from "./dockview-adapter";

/** A screen-sized box: sizes travel as unrounded pixels, so any box reads back. */
const BOX = { width: 1280, height: 720 };

const pane = (id: string) => ({ id, path: `/node/${id}` });

/** Fractions to four places that sum to 1 and are not all (within a hundredth) one share. */
function sharesOf(weights: readonly number[]): number[] | undefined {
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.round((w / total) * 10_000) / 10_000);
  shares[shares.length - 1] =
    Math.round((1 - shares.slice(0, -1).reduce((a, b) => a + b, 0)) * 10_000) / 10_000;
  const even = 1 / shares.length;
  return shares.every((s) => Math.abs(s - even) < 0.01) || shares.some((s) => s <= 0 || s >= 1)
    ? undefined
    : shares;
}

/** Legal layouts: tabs, or splits of two to three layouts running across their parent. */
function layouts(): fc.Arbitrary<LayoutTree> {
  let next = 0;
  const tabs = fc
    .record({ count: fc.integer({ min: 1, max: 3 }), active: fc.nat() })
    .map(({ count, active }): LayoutTree => {
      const panes = Array.from({ length: count }, () => pane(`p${next++}`));
      const [first, ...rest] = panes;
      if (first === undefined) throw new Error("no pane");
      const chosen = panes[active % count];
      return chosen === undefined || chosen.id === first.id
        ? { tabs: [first, ...rest] }
        : { tabs: [first, ...rest], active: chosen.id };
    });
  const tree = (direction: "row" | "column", depth: number): fc.Arbitrary<LayoutTree> =>
    depth === 0
      ? tabs
      : fc.oneof(
          tabs,
          fc
            .record({
              children: fc.array(tree(direction === "row" ? "column" : "row", depth - 1), {
                minLength: 2,
                maxLength: 3,
              }),
              weights: fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 3, maxLength: 3 }),
            })
            .map(({ children, weights }): LayoutTree => {
              const sizes = sharesOf(weights.slice(0, children.length));
              return sizes === undefined
                ? { split: direction, children }
                : { split: direction, children, sizes };
            }),
        );
  return fc
    .constantFrom<"row" | "column">("row", "column")
    .chain((direction) => tree(direction, 3));
}

describe("dockview adapter", () => {
  it("kb tree → dockview → kb tree is the identity (fast-check)", () => {
    fc.assert(
      fc.property(layouts(), (tree) => {
        expect(Result.isSuccess(decodeLayout(tree))).toBe(true);
        expect(fromDockview(toDockview(tree, BOX))).toEqual(tree);
      }),
      { numRuns: 300 },
    );
  });

  it("lays a row out side by side, and lone tabs as a row of one", () => {
    const row: LayoutTree = {
      split: "row",
      children: [{ tabs: [pane("a")] }, { tabs: [pane("b")] }],
    };
    const projected = toDockview(row, { width: 1000, height: 600 });
    expect(projected.grid.orientation).toBe(Orientation.HORIZONTAL);
    expect(projected.grid.root).toMatchObject({
      type: "branch",
      size: 600,
      data: [
        { type: "leaf", size: 500, data: { views: ["a"], activeView: "a" } },
        { type: "leaf", size: 500, data: { views: ["b"], activeView: "b" } },
      ],
    });
    expect(projected.panels.a).toMatchObject({ id: "a", params: { path: "/node/a" } });
    const lone = toDockview({ tabs: [pane("a")] }, { width: 1000, height: 600 });
    expect(lone.grid.root).toMatchObject({ type: "branch", data: [{ type: "leaf" }] });
    expect(fromDockview(lone)).toEqual({ tabs: [pane("a")] });
  });

  it("reads a resize back as fractions, and an even split as none", () => {
    const row: LayoutTree = {
      split: "row",
      children: [{ tabs: [pane("a")] }, { tabs: [pane("b")] }],
    };
    const projected = toDockview(row, { width: 1000, height: 600 });
    const [left, right] = Array.isArray(projected.grid.root.data) ? projected.grid.root.data : [];
    if (left === undefined || right === undefined) throw new Error("two leaves");
    expect(fromDockview(projected)).toEqual(row);
    left.size = 300;
    right.size = 700;
    expect(fromDockview(projected)).toEqual({ ...row, sizes: [0.3, 0.7] });
  });
});
