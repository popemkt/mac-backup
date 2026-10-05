/**
 * A face's editor laid on the face as the camera draws it (`canvas-face-overlay`):
 * the element's corners land on the face's projected corners exactly —
 * turned, tipped, through perspective — and a face seen from behind or
 * passing behind the eye gets no editor.
 */
import { describe, expect, test } from "vitest";
import { boxFrame, frameCorners, type CanvasNode } from "@kb/canvas";
import { presetView, projectPoint, type CanvasView } from "./canvas-camera";
import { faceFrameOf } from "./canvas-faces";
import { faceTransform, quadTransform } from "./canvas-face-overlay";

/** Where a `matrix3d` (transform-origin 0 0) puts a point of the element, perspective divided. */
function apply(matrix: string, x: number, y: number): { x: number; y: number } {
  const m = (/matrix3d\(([^)]*)\)/.exec(matrix)?.[1] ?? "").split(",").map(Number);
  const at = (i: number) => m[i] ?? Number.NaN;
  const w = at(3) * x + at(7) * y + at(15);
  return { x: (at(0) * x + at(4) * y + at(12)) / w, y: (at(1) * x + at(5) * y + at(13)) / w };
}

const size = { width: 1200, height: 800 };
const view: CanvasView = { x: 200, y: 100, z: 0, zoom: 0.9, yaw: 0.6, pitch: 0.8, fov: 34 };

describe("a face's editor", () => {
  test("the element's corners land on any four points", () => {
    const quad = [
      { x: 100, y: 120 },
      { x: 420, y: 90 },
      { x: 460, y: 300 },
      { x: 80, y: 260 },
    ] as const;
    const matrix = quadTransform(200, 80, quad);
    expect(matrix).not.toBeNull();
    if (matrix === null) return;
    [
      [0, 0],
      [200, 0],
      [200, 80],
      [0, 80],
    ].forEach(([x = 0, y = 0], i) => {
      const p = apply(matrix, x, y);
      expect(p.x).toBeCloseTo(quad[i]?.x ?? Number.NaN, 6);
      expect(p.y).toBeCloseTo(quad[i]?.y ?? Number.NaN, 6);
    });
  });

  test("on a turned, tipped card it lies on the face the camera model projects", () => {
    const card: CanvasNode = {
      id: "c",
      type: "text",
      text: "",
      x: 100,
      y: 50,
      width: 220,
      height: 90,
      z: 40,
      rotation: { x: -35, z: 25 },
    };
    const frame = faceFrameOf(card, 40, view);
    const matrix = faceTransform(frame, view, size);
    expect(matrix).not.toBeNull();
    if (matrix === null) return;
    const corners = frameCorners(boxFrame(card)).slice(0, 4);
    [
      [0, 0],
      [220, 0],
      [220, 90],
      [0, 90],
    ].forEach(([x = 0, y = 0], i) => {
      const corner = corners[i];
      const model = corner === undefined ? null : projectPoint(view, size, corner);
      const p = apply(matrix, x, y);
      expect(p.x).toBeCloseTo(model?.x ?? Number.NaN, 6);
      expect(p.y).toBeCloseTo(model?.y ?? Number.NaN, 6);
    });
  });

  test("a solid's top is edited on its top, a sphere's words in front of it", () => {
    const box: CanvasNode = {
      id: "b",
      type: "shape",
      shape: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      depth: 60,
    };
    expect(faceFrameOf(box, 0, view).centre.z).toBeCloseTo(60, 9);
    const ball: CanvasNode = { ...box, id: "s", shape: "sphere" };
    const front = faceFrameOf(ball, 0, view);
    // Square to the camera: its normal is the view's back.
    const back = {
      x: -Math.sin(view.yaw) * Math.sin(view.pitch),
      y: Math.cos(view.yaw) * Math.sin(view.pitch),
      z: Math.cos(view.pitch),
    };
    expect(front.matrix[2]).toBeCloseTo(back.x, 9);
    expect(front.matrix[5]).toBeCloseTo(back.y, 9);
    expect(front.matrix[8]).toBeCloseTo(back.z, 9);
  });

  test("a face seen from behind has no editor: its words would read mirrored", () => {
    const card: CanvasNode = {
      id: "c",
      type: "text",
      text: "",
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      rotation: { x: 180 },
    };
    const top = presetView({ ...view, x: 100, y: 40 }, "top");
    expect(faceTransform(faceFrameOf(card, 0, top), top, size)).toBeNull();
  });
});
