import { describe, expect, test } from "vitest";
import { canvasMembership, type CanvasDoc } from "@kb/canvas";
import {
  EMPTY_SELECTION,
  addNodes,
  deleteSelected,
  enterToward,
  marqueeSelect,
  pickAllIn,
  pickIn,
  scopeIn,
  selectAll,
  selectEdge,
  selectNode,
  selectionCount,
  selectionEmpty,
  toggleNode,
} from "./canvas-selection";

const sampleDoc: CanvasDoc = {
  nodes: [
    { id: "a", type: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 60, label: "" },
    {
      id: "b",
      type: "shape",
      shape: "rect",
      x: 200,
      y: 0,
      width: 100,
      height: 60,
      label: "",
    },
    { id: "c", type: "text", text: "", x: 0, y: 200, width: 100, height: 60 },
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

describe("the scope a selection is made in", () => {
  /** frame ⊃ { a, inner ⊃ { b } }, and a loose c. */
  const membership = canvasMembership([
    { id: "frame", type: "group", x: 0, y: 0, width: 400, height: 300 },
    { id: "a", type: "text", text: "", x: 0, y: 0, width: 10, height: 10, parent: "frame" },
    { id: "inner", type: "group", x: 0, y: 0, width: 200, height: 200, parent: "frame" },
    { id: "b", type: "text", text: "", x: 0, y: 0, width: 10, height: 10, parent: "inner" },
    { id: "c", type: "text", text: "", x: 0, y: 0, width: 10, height: 10 },
  ]);

  test("a press reaches the item that belongs directly to the scope", () => {
    expect(pickIn(membership, "b", null)).toEqual({ id: "frame", scope: null });
    expect(pickIn(membership, "b", "frame")).toEqual({ id: "inner", scope: "frame" });
    expect(pickIn(membership, "b", "inner")).toEqual({ id: "b", scope: "inner" });
    expect(pickIn(membership, "c", null)).toEqual({ id: "c", scope: null });
  });

  test("a press outside the scope steps out of it, as far as it must", () => {
    expect(pickIn(membership, "a", "inner")).toEqual({ id: "a", scope: "frame" });
    expect(pickIn(membership, "c", "inner")).toEqual({ id: "c", scope: null });
    // The entered group's own body is outside it: the press selects the group.
    expect(pickIn(membership, "inner", "inner")).toEqual({ id: "inner", scope: "frame" });
    // A scope that is gone is the canvas.
    expect(pickIn(membership, "b", "gone")).toEqual({ id: "frame", scope: null });
    expect(scopeIn(membership, "a")).toBeNull();
  });

  test("a double-click goes one group deeper toward the item, or is the item's own", () => {
    expect(enterToward(membership, "b", null)).toEqual({ id: "inner", scope: "frame" });
    expect(enterToward(membership, "b", "frame")).toEqual({ id: "b", scope: "inner" });
    expect(enterToward(membership, "b", "inner")).toBeNull();
    expect(enterToward(membership, "c", null)).toBeNull();
    // On a group a press selects whole: into it, with nothing selected.
    expect(enterToward(membership, "frame", null)).toEqual({ id: null, scope: "frame" });
  });

  test("a marquee picks as a press would, and nothing outside the scope", () => {
    const all = ["frame", "a", "inner", "b", "c"];
    expect(pickAllIn(membership, all, null)).toEqual(new Set(["frame", "c"]));
    expect(pickAllIn(membership, all, "frame")).toEqual(new Set(["a", "inner"]));
    expect(pickAllIn(membership, all, "inner")).toEqual(new Set(["b"]));
  });
});
