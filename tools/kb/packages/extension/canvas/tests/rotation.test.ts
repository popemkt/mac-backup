/**
 * How an item turns: the one order the three angles apply in (Blender's XYZ
 * Euler, `Rz · Ry · Rx`), read back from any rotation matrix, and how a
 * turned item reads and writes in the document.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  apply,
  axisAngleOf,
  boxCorners,
  boxTop,
  canvasRotation,
  faceShare,
  multiply,
  normalizeDegrees,
  paintOrder,
  parseCanvasDoc,
  planeCorners,
  presetItem,
  rotationMatrix,
  rotationOfMatrix,
  selectionPivot,
  stillAbout,
  stringifyCanvasDoc,
  topView,
  transformItem,
  turnAbout,
  withRotation,
  type CanvasMatrix,
  type CanvasNode,
} from "../src/index.ts";

const angle = fc.double({ min: -179.9, max: 179.9, noNaN: true });
const close = (a: CanvasMatrix, b: CanvasMatrix, digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? Number.NaN, digits));
/** Rounded to whole units, with no negative zero. */
const whole = (v: { x: number; y: number; z: number }) =>
  [v.x, v.y, v.z].map((n) => Math.round(n) + 0);

describe("the rotation order", () => {
  test("x first, then y, then z, each about the canvas's fixed axes", () => {
    // A quarter turn about x then a quarter about z: +y goes up (z), and +x to +y.
    const m = rotationMatrix({ x: 90, y: 0, z: 90 });
    const up = apply(m, { x: 0, y: 1, z: 0 });
    expect(whole(up)).toEqual([0, 0, 1]);
    const across = apply(m, { x: 1, y: 0, z: 0 });
    expect(whole(across)).toEqual([0, 1, 0]);
  });

  test("positive z turns clockwise as the top view shows it, as CSS rotate does", () => {
    const m = rotationMatrix({ x: 0, y: 0, z: 90 });
    // Right (+x) turns to down the page (+y).
    const p = apply(m, { x: 1, y: 0, z: 0 });
    expect(p.y).toBeCloseTo(1, 12);
  });

  test("a turn about z on top of any turn only adds to its z angle", () => {
    fc.assert(
      fc.property(angle, angle, angle, angle, (x, y, z, by) => {
        fc.pre(Math.abs(y) < 89);
        const spun = multiply(
          turnAbout({ x: 0, y: 0, z: 1 }, (by * Math.PI) / 180),
          rotationMatrix({ x, y, z }),
        );
        close(spun, rotationMatrix({ x, y, z: z + by }));
      }),
    );
  });

  test("any rotation matrix reads back as angles that build it again", () => {
    // Angles are kept to a ten-thousandth of a degree, so the matrix comes back to about 1e-6.
    fc.assert(
      fc.property(angle, angle, angle, (x, y, z) => {
        const m = rotationMatrix({ x, y, z });
        close(rotationMatrix(rotationOfMatrix(m)), m, 5);
      }),
    );
    // At the gimbal lock the matrix still comes back.
    const locked = rotationMatrix({ x: 30, y: 90, z: 10 });
    close(rotationMatrix(rotationOfMatrix(locked)), locked, 5);
  });

  test("a turn about one axis reads back as that axis and angle", () => {
    const axis = { x: 0.48, y: 0.6, z: 0.64 };
    const { axis: back, angle: radians } = axisAngleOf(turnAbout(axis, 1.1));
    expect(radians).toBeCloseTo(1.1, 9);
    expect([back.x, back.y, back.z].map((v) => Math.round(v * 100))).toEqual([48, 60, 64]);
  });

  test("angles are written within (-180, 180]", () => {
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(1e-9)).toBe(0);
  });
});

describe("a turned item", () => {
  const card: CanvasNode = { id: "a", type: "text", text: "", x: 0, y: 0, width: 200, height: 100 };

  test("rotation round-trips as written, and an unreadable one stays verbatim", () => {
    const raw = {
      nodes: [
        { ...card, rotation: { z: 30 } },
        { ...card, id: "b", rotation: { x: 0, y: -12.5, z: 400 } },
        { ...card, id: "c", rotation: { z: "a lot" } },
        { ...card, id: "d", rotation: { z: 30, w: 1 } },
      ],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
    expect(canvasRotation(doc.nodes[0] as CanvasNode)).toEqual({ x: 0, y: 0, z: 30 });
    expect(canvasRotation(doc.nodes[2] as CanvasNode)).toEqual({ x: 0, y: 0, z: 0 });
    // Writing a turn supersedes the one kb could not read.
    expect(withRotation(doc.nodes[2] as CanvasNode, { x: 0, y: 0, z: 5 }).extra).toBeUndefined();
  });

  test("turning writes only the angles that are not 0; turned back, the item is as it was", () => {
    const turned = withRotation(card, { x: 0, y: 0, z: 375 });
    expect(turned.rotation).toEqual({ z: 15 });
    expect(withRotation(turned, { x: 0, y: 0, z: 0 })).toEqual(card);
  });

  test("a turned box's corners and top turn about its centre", () => {
    const box = { x: 0, y: 0, width: 100, height: 100, depth: 100, rotation: { x: 90 } };
    expect(boxTop(box)).toBeCloseTo(100, 9);
    const tilted = { ...box, rotation: { x: 45 } };
    // Its highest corner now stands √2 · 50 above its centre.
    expect(boxTop(tilted)).toBeCloseTo(50 + Math.SQRT2 * 50, 9);
    // A quarter turn about z keeps a square's corners where they were, in another order.
    const spun = boxCorners({ ...box, rotation: { z: 90 } });
    expect(spun[0]?.x).toBeCloseTo(100, 9);
    expect(spun[0]?.y).toBeCloseTo(0, 9);
  });

  test("paint order goes by a turned item's highest corner", () => {
    const low = { ...card, id: "low", z: 40 };
    const tipped = { ...card, id: "tipped", depth: 20, rotation: { x: 90 } };
    expect(paintOrder([tipped, low]).map((n) => n.id)).toEqual(["low", "tipped"]);
  });

  test("the face lies on a prism's top, an ellipsoid's equator and a cone's base", () => {
    const at = { x: 0, y: 0 };
    expect(faceShare(presetItem("box", at, "b"))).toBe(1);
    expect(faceShare(presetItem("sphere", at, "s"))).toBe(0.5);
    expect(faceShare(presetItem("cone", at, "c"))).toBe(0);
    const box = { x: 0, y: 0, width: 100, height: 60, depth: 40, rotation: { y: 90 } };
    // Turned a quarter about y, a box's top faces +x.
    for (const corner of planeCorners(box, 1)) expect(corner.x).toBeCloseTo(70, 9);
  });

  test("its top view is its footprint unturned, and its silhouette turned", () => {
    const flat = topView({ x: 0, y: 0, width: 100, height: 60 }, 0);
    const xs = flat.map(([x]) => x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 100]);
    // A cube tipped 45° about x shows its top and a side: √2 · 100 deep from above.
    const cube = { x: 0, y: 0, width: 100, height: 100, depth: 100, rotation: { x: 45 } };
    const ys = topView(cube, 0).map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(Math.SQRT2 * 100, 6);
    // A sphere's silhouette is its footprint however it turns.
    const ball = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      depth: 100,
      shape: "sphere" as const,
      rotation: { x: 33, y: 71 },
    };
    const extent = topView(ball, 0).map(([x]) => x);
    expect(Math.max(...extent) - Math.min(...extent)).toBeCloseTo(100, 0);
  });
});

describe("transforming items about a pivot", () => {
  const block: CanvasNode = {
    id: "b",
    type: "shape",
    shape: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    depth: 40,
  };
  const quarter = turnAbout({ x: 0, y: 0, z: 1 }, Math.PI / 2);

  test("still, an item is exactly as it was", () => {
    expect(transformItem(block, stillAbout({ x: 3, y: 4, z: 5 }))).toEqual(block);
  });

  test("turned about its own centre, an item only turns", () => {
    const turned = transformItem(block, { ...stillAbout(selectionPivot([block])), turn: quarter });
    expect([turned.x, turned.y, turned.z, turned.width]).toEqual([0, 0, undefined, 100]);
    expect(turned.rotation).toEqual({ z: 90 });
  });

  test("turned about another point, an item swings round it and turns", () => {
    const turned = transformItem(block, { ...stillAbout({ x: 0, y: 0, z: 0 }), turn: quarter });
    // Its centre (50, 30) swings to (-30, 50).
    expect(turned.x + turned.width / 2).toBeCloseTo(-30, 6);
    expect(turned.y + turned.height / 2).toBeCloseTo(50, 6);
    expect(turned.rotation).toEqual({ z: 90 });
  });

  test("stretched along its own axes, its sides grow and its centre holds", () => {
    const grown = transformItem(block, {
      ...stillAbout(selectionPivot([block])),
      axes: rotationMatrix({ x: 0, y: 0, z: 0 }),
      stretch: { x: 2, y: 1, z: 0.5 },
    });
    expect([grown.x, grown.width, grown.height, grown.depth, grown.z]).toEqual([
      -50, 200, 60, 20, 10,
    ]);
  });

  test("the pivot is the centre of the box bounding every item", () => {
    const other = { ...block, id: "o", x: 200, z: 100 };
    expect(selectionPivot([block, other])).toEqual({ x: 150, y: 30, z: 70 });
  });
});
