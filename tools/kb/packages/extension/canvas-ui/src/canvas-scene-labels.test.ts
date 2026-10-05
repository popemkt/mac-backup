/**
 * The 3D canvas's standing labels (`canvas-scene-labels`): a sphere's, a
 * cone's and a solid billboard's face stand square to the camera in front of
 * the body, turn with the view, and are repainted only when their words or
 * the selection change.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import {
  boxCorners,
  frameCorners,
  frontFrame,
  type CanvasAxes,
  type CanvasDoc,
  type CanvasNode,
  type CanvasShapeNode,
} from "@kb/canvas";
import { fakeCanvasContexts } from "@kb/ui-test-kit";
import type { CardLook } from "./canvas-card-face";
import { LabelLayer } from "./canvas-scene-labels";
import { fromThree } from "./canvas-scene-space";

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

const solid = (
  id: string,
  shape: "rect" | "sphere" | "cone",
  extra: Partial<CanvasShapeNode> = {},
): CanvasShapeNode => ({
  id,
  type: "shape",
  shape,
  label: id,
  x: 0,
  y: 0,
  width: 120,
  height: 120,
  depth: 120,
  ...extra,
});

const content = (nodes: CanvasNode[], selected: string[] = []) => ({
  doc: { nodes, edges: [] } satisfies CanvasDoc,
  nodes: new Map(),
  selection: { nodeIds: new Set(selected), edgeIds: new Set<string>() },
});

/** Level with the floor from the front (+y): screen right is x, up is z. */
const LEVEL: CanvasAxes = {
  right: { x: 1, y: 0, z: 0 },
  down: { x: 0, y: 0, z: -1 },
  back: { x: 0, y: 1, z: 0 },
};
/** From the right (+x), level. */
const FROM_RIGHT: CanvasAxes = {
  right: { x: 0, y: -1, z: 0 },
  down: { x: 0, y: 0, z: -1 },
  back: { x: 1, y: 0, z: 0 },
};

const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x * b.x + a.y * b.y + a.z * b.z;

describe("standing labels", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  let contexts: { mock: { calls: unknown[] }; mockClear: () => void } | null = null;

  beforeAll(() => {
    const dom = new Window();
    const globals = { window: dom, document: dom.document };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
    fakeCanvasContexts(dom.HTMLCanvasElement.prototype);
    contexts = vi.spyOn(dom.HTMLCanvasElement.prototype, "getContext");
  });

  afterAll(() => {
    for (const [key, value] of saved) g[key] = value;
  });

  test("a solid with no flat top, or a solid billboard, stands a label; a box does not", () => {
    const layer = new LabelLayer(look);
    layer.sync(
      content([
        solid("ball", "sphere"),
        solid("spire", "cone"),
        solid("crate", "rect"),
        solid("post", "rect", { billboard: true }),
        solid("flat", "sphere", { depth: 0 }),
      ]),
    );
    expect([...layer.ids].toSorted()).toEqual(["ball", "post", "spire"]);
    layer.dispose();
  });

  test("a label stands square to the camera, in front of its whole body, and turns with the view", () => {
    const ball = solid("ball", "sphere", { rotation: { x: 25, z: 40 } });
    const layer = new LabelLayer(look);
    layer.sync(content([ball]));
    for (const axes of [LEVEL, FROM_RIGHT]) {
      layer.face(axes);
      const corners = (layer.cornersOf("ball") ?? []).map(fromThree);
      expect(corners).toHaveLength(4);
      // Square to the camera: all four at one depth, and as wide and tall as the footprint.
      const depths = corners.map((c) => dot(c, axes.back));
      for (const d of depths) expect(d).toBeCloseTo(depths[0] ?? 0, 6);
      const [tl, tr, , bl] = corners;
      if (tl === undefined || tr === undefined || bl === undefined) return;
      expect(dot({ x: tr.x - tl.x, y: tr.y - tl.y, z: tr.z - tl.z }, axes.right)).toBeCloseTo(
        120,
        6,
      );
      expect(dot({ x: bl.x - tl.x, y: bl.y - tl.y, z: bl.z - tl.z }, axes.down)).toBeCloseTo(
        120,
        6,
      );
      // In front of every corner of the box it stands for.
      for (const corner of boxCorners(ball)) {
        expect(dot(corner, axes.back)).toBeLessThan(depths[0] ?? 0);
      }
      // Exactly where the camera model stands it (`frontFrame`).
      frameCorners(frontFrame(ball, axes))
        .slice(0, 4)
        .forEach((model, i) => {
          expect(corners[i]?.x).toBeCloseTo(model.x, 6);
          expect(corners[i]?.y).toBeCloseTo(model.y, 6);
          expect(corners[i]?.z).toBeCloseTo(model.z, 6);
        });
    }
    layer.dispose();
  });

  test("a label is repainted only when its words or the selection change", () => {
    const layer = new LabelLayer(look);
    const ball = solid("ball", "sphere");
    layer.sync(content([ball]));
    contexts?.mockClear();
    layer.sync(content([{ ...ball, x: 40 }]));
    layer.face(LEVEL);
    expect(contexts?.mock.calls.length).toBe(0);
    layer.sync(content([{ ...ball, label: "renamed" }]));
    expect(contexts?.mock.calls.length).toBe(1);
    layer.sync(content([{ ...ball, label: "renamed" }], ["ball"]));
    expect(contexts?.mock.calls.length).toBe(2);
    layer.dispose();
  });
});
