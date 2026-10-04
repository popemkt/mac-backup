/** The 3D canvas redraws an edge only when what it is drawn from changes. */
import { describe, expect, test, vi } from "vitest";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import type { CanvasDoc, CanvasNode } from "@kb/canvas";
import type { CardLook } from "./canvas-card-face";
import { EdgeLayer } from "./canvas-scene-edges";

const look: CardLook = {
  face: "rgb(255, 255, 255)",
  ink: "rgb(20, 20, 20)",
  primary: "rgb(190, 120, 20)",
  danger: "rgb(200, 30, 30)",
  presets: {},
  font: "sans-serif",
  body: 14.5,
  ui: 13,
  label: 11,
  radius: 18,
  shapeRadius: 8,
};

const card = (id: string, x: number): CanvasNode => ({
  id,
  type: "text",
  text: id,
  x,
  y: 0,
  width: 100,
  height: 60,
});

const content = (nodes: CanvasNode[], edgeIds: string[] = []) => ({
  doc: {
    nodes,
    edges: [
      { id: "ab", fromNode: "a", toNode: "b" },
      { id: "bc", fromNode: "b", toNode: "c" },
    ],
  } satisfies CanvasDoc,
  nodes: new Map(),
  selection: { nodeIds: new Set<string>(), edgeIds: new Set(edgeIds) },
});

describe("edges in depth", () => {
  test("a drag redraws only the edges of the card it moves", () => {
    const drawn = vi.spyOn(LineGeometry.prototype, "setPositions");
    const layer = new EdgeLayer(look);
    const [a, b, c] = [card("a", 0), card("b", 200), card("c", 400)];
    layer.sync(content([a, b, c]));
    expect(drawn).toHaveBeenCalledTimes(2);
    layer.sync(content([a, b, { ...c, x: 450 }]));
    expect(drawn).toHaveBeenCalledTimes(3);
    layer.sync(content([a, b, { ...c, x: 450 }], ["ab"]));
    expect(drawn).toHaveBeenCalledTimes(4);
    layer.sync(content([a, b, { ...c, x: 450 }], ["ab"]));
    expect(drawn).toHaveBeenCalledTimes(4);
    expect(layer.ids).toEqual(["ab", "bc"]);
    layer.dispose();
    drawn.mockRestore();
  });
});
