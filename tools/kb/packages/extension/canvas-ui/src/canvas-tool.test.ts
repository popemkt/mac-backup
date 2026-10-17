import { describe, expect, test } from "vitest";
import { present } from "@kb/model";
import {
  boxFrame,
  edgeRoute,
  parseCanvasDoc,
  presetItem,
  stringifyCanvasDoc,
  svgPathData,
  type CanvasDoc,
} from "@kb/canvas";
import {
  pickTool,
  placesItem,
  placeWithTool,
  pressWithTool,
  reduceCanvasTool,
  toolTakes,
  type ToolState,
} from "./canvas-tool";

const createShapeNode = (kind: "rect" | "ellipse" | "diamond", x: number, y: number, id: string) =>
  presetItem(kind, { x, y }, id);

describe("canvas tool reducer", () => {
  test("set-tool switches active tool", () => {
    expect(reduceCanvasTool({ tool: "select" }, { type: "set-tool", tool: "rect" })).toEqual({
      tool: "rect",
    });
  });

  test("escape and a used tool revert to select", () => {
    expect(reduceCanvasTool({ tool: "diamond" }, { type: "escape" })).toEqual({ tool: "select" });
    expect(reduceCanvasTool({ tool: "ellipse" }, { type: "used" })).toEqual({ tool: "select" });
  });

  test("the solid tool picks a box first, then whichever solid was picked last", () => {
    expect(reduceCanvasTool({ tool: "select" }, { type: "set-tool", tool: "solid" })).toEqual({
      tool: "box",
      picked: { solid: "box" },
    });
    const sphere = reduceCanvasTool({ tool: "select" }, { type: "set-tool", tool: "sphere" });
    const placed = reduceCanvasTool(sphere, { type: "used" });
    expect(placed).toEqual({ tool: "select", picked: { solid: "sphere" } });
    // A flat tool in between does not forget it.
    const text = reduceCanvasTool(placed, { type: "set-tool", tool: "text" });
    expect(reduceCanvasTool(text, { type: "set-tool", tool: "solid" })).toEqual({
      tool: "sphere",
      picked: { solid: "sphere" },
    });
  });
});

describe("placeWithTool", () => {
  const empty: CanvasDoc = { nodes: [], edges: [] };

  test("places rect and reverts tool", () => {
    const result = placeWithTool(empty, "rect", { x: 12, y: 34 }, "id-1");
    const placed = present(result, "placed rect");
    expect(placed.nextTool).toBe("select");
    expect(placed.node).toMatchObject({
      id: "id-1",
      type: "shape",
      shape: "rect",
      x: 12,
      y: 34,
      width: 160,
      height: 100,
    });
    expect(placed.doc.nodes).toHaveLength(1);
  });

  test("places text card", () => {
    const result = placeWithTool(empty, "text", { x: 0, y: 0 }, "t1");
    const placed = present(result, "placed text");
    expect(placed.node).toMatchObject({ type: "text", text: "" });
  });

  test("every placing tool makes its preset, and a card is placed with its node", () => {
    expect(placeWithTool(empty, "group", { x: 1, y: 2 }, "g")?.node).toEqual({
      id: "g",
      type: "group",
      x: 1,
      y: 2,
      width: 300,
      height: 200,
    });
    expect(presetItem("kb-node", { x: 0, y: 0 }, "k", "n.a")).toMatchObject({
      type: "kb-node",
      nodeId: "n.a",
      width: 280,
      height: 72,
    });
  });

  test("select and kb-node return null", () => {
    expect(placeWithTool(empty, "select", { x: 0, y: 0 }, "a")).toBeNull();
    expect(placeWithTool(empty, "kb-node", { x: 0, y: 0 }, "a")).toBeNull();
  });
});

describe("edge-to-shape connectivity", () => {
  test("an edge's route connects shape nodes by id geometry", () => {
    const from = createShapeNode("rect", 0, 0, "s-from");
    const to = createShapeNode("ellipse", 300, 40, "s-to");
    const d = svgPathData(
      edgeRoute(from, to, {
        id: "e1",
        fromNode: from.id,
        toNode: to.id,
        fromSide: "right",
        toSide: "left",
      }).path,
    );
    expect(d.startsWith("M ")).toBe(true);
    expect(d).toContain(`${from.x + from.width}`);
    expect(d).toContain(`${to.x}`);
  });

  test("shape↔shape edge survives doc round-trip", () => {
    const from = createShapeNode("diamond", 10, 10, "a");
    const to = createShapeNode("rect", 200, 10, "b");
    const doc: CanvasDoc = {
      nodes: [from, to],
      edges: [
        {
          id: "e1",
          fromNode: "a",
          toNode: "b",
          fromSide: "right",
          toSide: "left",
          toEnd: "arrow",
        },
      ],
    };
    const again = parseCanvasDoc(stringifyCanvasDoc(doc));
    expect(again.edges[0]).toMatchObject({
      fromNode: "a",
      toNode: "b",
    });
    expect(again.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("placing into frames", () => {
  test("every tool but select and the card places on a press; both projections ask this", () => {
    expect(placesItem("rect")).toBe(true);
    expect(placesItem("group")).toBe(true);
    expect(placesItem("select")).toBe(false);
    expect(placesItem("kb-node")).toBe(false);
  });

  test("picking a tool placed with a choice opens its chooser with select armed, never sticky", () => {
    const log: string[] = [];
    let state: ToolState = { tool: "rect", sticky: true };
    const to = {
      setToolState: (next: (s: ToolState) => ToolState) => {
        state = next(state);
      },
      choose: (chooser: string) => log.push(chooser),
    };
    pickTool("kb-node", false, to);
    expect(state).toEqual({ tool: "select" });
    expect(log).toEqual(["node"]);
    pickTool("kb-node", true, to);
    expect(log).toEqual(["node"]);
    pickTool("ellipse", true, to);
    expect(state).toMatchObject({ tool: "ellipse", sticky: true });
    pickTool("select", true, to);
    expect(state).toEqual({ tool: "select" });
  });

  test("an item placed on a frame stood up as a wall lies on its face and belongs to it", () => {
    const wall = {
      id: "w",
      type: "group",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      z: 150,
      rotation: { x: -90 },
    } as const;
    const doc: CanvasDoc = { nodes: [wall], edges: [] };
    const face = boxFrame(wall);
    const placed = placeWithTool(doc, "text", { x: 60, y: 150, z: 260 }, "t", face);
    expect(placed?.doc.nodes.at(-1)).toMatchObject({ id: "t", parent: "w", rotation: { x: -90 } });
  });

  test("an item placed over a frame belongs to it", () => {
    const doc: CanvasDoc = {
      nodes: [{ id: "f", type: "group", x: 0, y: 0, width: 600, height: 400 }],
      edges: [],
    };
    const placed = placeWithTool(doc, "rect", { x: 100, y: 100 }, "r");
    expect(placed?.doc.nodes.at(-1)).toMatchObject({ id: "r", parent: "f" });
    const outside = placeWithTool(doc, "rect", { x: 900, y: 900 }, "o");
    expect(outside?.doc.nodes.at(-1)).not.toHaveProperty("parent");
  });
});

describe("a press with the armed tool", () => {
  const frame = { id: "f", type: "group", x: 0, y: 0, width: 600, height: 400 } as const;
  const card = presetItem("rect", { x: 700, y: 0 }, "c");
  const doc: CanvasDoc = { nodes: [frame, card], edges: [] };
  const floor = { at: { x: 40, y: 50, z: 0 }, face: null };

  test("a tool takes the presses it means something on: a placing tool a frame's, the comment tool any item's", () => {
    expect([toolTakes("rect", frame), toolTakes("rect", card)]).toEqual([true, false]);
    expect([toolTakes("comment", frame), toolTakes("comment", card)]).toEqual([true, true]);
    expect([toolTakes("select", frame), toolTakes("hand", card)]).toEqual([false, false]);
  });

  test("the comment tool starts a thread on the item it is pressed on, or at the point", () => {
    expect(pressWithTool(doc, "comment", { place: floor, item: card }, "x")).toEqual({
      kind: "comment",
      place: { on: "c" },
    });
    expect(pressWithTool(doc, "comment", { place: floor, item: null }, "x")).toEqual({
      kind: "comment",
      place: { at: { x: 40, y: 50 } },
    });
    expect(pressWithTool(doc, "comment", { place: null, item: null }, "x")).toBeNull();
  });

  test("a placing tool places at the spot, and select does nothing there", () => {
    const placed = pressWithTool(doc, "rect", { place: floor, item: frame }, "r");
    expect(placed?.kind === "place" && placed.doc.nodes.at(-1)).toMatchObject({
      id: "r",
      parent: "f",
    });
    expect(pressWithTool(doc, "select", { place: floor, item: null }, "s")).toBeNull();
    expect(pressWithTool(doc, "rect", { place: null, item: frame }, "r")).toBeNull();
  });
});
