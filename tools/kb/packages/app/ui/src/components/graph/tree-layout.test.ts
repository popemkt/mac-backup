import { describe, expect, it } from "vitest";
import type { LensTreeNode } from "@/lib/graph-lens";
import { OPEN_DEPTH, initiallyCollapsed, layoutForest } from "./tree-layout";

const node = (id: string, children: LensTreeNode[] = []): LensTreeNode => ({
  id,
  label: id,
  color: "#123456",
  size: 3,
  children,
});
const label = { show: true, measure: (text: string) => text.length * 6 };

describe("tree layout", () => {
  it(`opens ${OPEN_DEPTH} levels: deeper branches start folded`, () => {
    const forest = [node("r", [node("a", [node("a1", [node("a11")])]), node("b")])];
    expect([...initiallyCollapsed(forest)]).toEqual(["a", "a1"]);
    const laid = layoutForest(forest, initiallyCollapsed(forest), label, 1.6);
    expect(laid.nodes.map((n) => n.data.id).toSorted()).toEqual(["a", "b", "r"]);
  });

  it("lays a tree out left to right", () => {
    const laid = layoutForest([node("r", [node("c")])], new Set(), label, 1.6);
    const at = (id: string) => laid.nodes.find((n) => n.data.id === id);
    expect(at("c")?.y ?? 0).toBeGreaterThan(at("r")?.y ?? 0);
  });

  it("packs a forest of many roots into columns shaped like the frame", () => {
    const forest = Array.from({ length: 120 }, (_, i) => node(`root-${i}`));
    const wide = layoutForest(forest, new Set(), label, 1.6);
    const columns = new Set(wide.nodes.map((n) => Math.round(n.y))).size;
    expect(columns).toBeGreaterThan(2);
    const ratio = wide.width / wide.height;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(3.2);
    // A tall frame packs fewer columns than a wide one.
    const tall = layoutForest(forest, new Set(), label, 0.5);
    expect(new Set(tall.nodes.map((n) => Math.round(n.y))).size).toBeLessThan(columns);
  });

  it("never overlaps two roots' subtrees", () => {
    const forest = Array.from({ length: 30 }, (_, i) => node(`r${i}`, [node(`r${i}c`)]));
    const laid = layoutForest(forest, new Set(), label, 1.6);
    const boxes = laid.nodes.map((n) => ({
      top: n.x - n.data.height / 2,
      bottom: n.x + n.data.height / 2,
      left: n.y,
      right: n.y + n.data.width,
    }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a === undefined || b === undefined) continue;
        const overlap =
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap).toBe(false);
      }
  });
});
