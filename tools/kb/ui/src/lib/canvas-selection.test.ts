import { describe, expect, test } from "vitest";
import type { CanvasDoc } from "@kb/canvas";
import {
  EMPTY_SELECTION,
  addNodes,
  deleteSelected,
  marqueeSelect,
  selectAll,
  selectEdge,
  selectNode,
  selectionCount,
  selectionEmpty,
  toggleNode,
} from "./canvas-selection";

const sampleDoc: CanvasDoc = {
  nodes: [
    { id: "a", type: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 60, label: "" } as any,
    { id: "b", type: "shape", shape: "rect", x: 200, y: 0, width: 100, height: 60, label: "" } as any,
    { id: "c", type: "text", text: "", x: 0, y: 200, width: 100, height: 60 } as any,
  ],
  edges: [
    { id: "e1", fromNode: "a", toNode: "b", toEnd: "arrow" },
    { id: "e2", fromNode: "b", toNode: "c", toEnd: "arrow" },
  ],
};

describe("canvas selection helpers", () => {
  test("EMPTY_SELECTION is empty", () => {
    expect(selectionEmpty(EMPTY_SELECTION)).toBe(true);
    expect(selectionCount(EMPTY_SELECTION)).toBe(0);
  });

  test("selectNode returns a single-node selection", () => {
    const sel = selectNode("a");
    expect(sel.nodeIds.has("a")).toBe(true);
    expect(selectionCount(sel)).toBe(1);
  });

  test("selectEdge returns a single-edge selection", () => {
    const sel = selectEdge("e1");
    expect(sel.edgeIds.has("e1")).toBe(true);
    expect(selectionCount(sel)).toBe(1);
  });

  test("toggleNode adds and removes", () => {
    let sel = selectNode("a");
    sel = toggleNode(sel, "b");
    expect(sel.nodeIds.size).toBe(2);
    sel = toggleNode(sel, "a");
    expect(sel.nodeIds.size).toBe(1);
    expect(sel.nodeIds.has("b")).toBe(true);
  });

  test("selectAll selects all nodes and edges", () => {
    const sel = selectAll(sampleDoc);
    expect(sel.nodeIds.size).toBe(3);
    expect(sel.edgeIds.size).toBe(2);
  });

  test("marqueeSelect finds intersecting nodes", () => {
    const hit = marqueeSelect(sampleDoc.nodes, { x: -10, y: -10, w: 150, h: 80 });
    expect(hit.has("a")).toBe(true);
    expect(hit.has("b")).toBe(false);
    expect(hit.has("c")).toBe(false);
  });

  test("marqueeSelect works with negative-direction rect", () => {
    const hit = marqueeSelect(sampleDoc.nodes, { x: 150, y: 80, w: -160, h: -90 });
    expect(hit.has("a")).toBe(true);
  });

  test("addNodes merges into existing selection", () => {
    const sel = selectNode("a");
    const added = addNodes(sel, new Set(["b", "c"]));
    expect(added.nodeIds.size).toBe(3);
  });
});

describe("deleteSelected", () => {
  test("deletes selected nodes and cascades edges", () => {
    const sel = selectNode("a");
    const result = deleteSelected(sampleDoc, sel);
    expect(result.nodes.map((n) => n.id)).toEqual(["b", "c"]);
    expect(result.edges.map((e) => e.id)).toEqual(["e2"]);
  });

  test("deletes selected edges only", () => {
    const sel = selectEdge("e1");
    const result = deleteSelected(sampleDoc, sel);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges.map((e) => e.id)).toEqual(["e2"]);
  });

  test("deleting node cascades all incident edges", () => {
    const sel = selectNode("b");
    const result = deleteSelected(sampleDoc, sel);
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(result.edges).toHaveLength(0);
  });

  test("empty selection is a no-op", () => {
    const result = deleteSelected(sampleDoc, EMPTY_SELECTION);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
  });
});
