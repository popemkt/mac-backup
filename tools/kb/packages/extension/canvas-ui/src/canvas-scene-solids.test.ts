/**
 * The mesh builders build what the shape table says: every shape, flat and
 * solid, fills exactly its box, faces outward, keeps its face on top, and
 * draws its edges as a diagram would.
 */
import { describe, expect, test } from "vitest";
import { Vector3 } from "three/webgpu";
import type { CanvasShapeKind } from "@kb/canvas";
import { BODY, FACE, solidGeometry, solidKey, type SolidSpec } from "./canvas-scene-solids";

const SHAPES: readonly CanvasShapeKind[] = ["rect", "ellipse", "diamond", "sphere", "cone"];
const spec = (shape: CanvasShapeKind, depth: number): SolidSpec => ({
  shape,
  width: 160,
  height: 100,
  depth,
  radius: 8,
  faceMargin: 14,
});

describe.each(SHAPES)("%s", (shape) => {
  test("flat, it is its footprint: a cap facing up, faced with the card, outlined", () => {
    const { geometry, edges, edgesWhenSelected } = solidGeometry(spec(shape, 0));
    const box = geometry.boundingBox;
    expect(box?.min.toArray()).toEqual([-80, -50, 0]);
    expect(box?.max.toArray()).toEqual([80, 50, 0]);
    expect(geometry.groups.map((g) => g.materialIndex)).toEqual([FACE]);
    const normals = geometry.getAttribute("normal");
    for (let i = 0; i < normals.count; i++) expect(normals.getZ(i)).toBe(1);
    expect(edges.length).toBeGreaterThan(0);
    expect(edgesWhenSelected).toBe(false);
  });

  test("solid, it fills its box, and every side faces outward", () => {
    const { geometry } = solidGeometry(spec(shape, 60));
    const box = geometry.boundingBox;
    expect(box?.min.x).toBeCloseTo(-80, 0);
    expect(box?.max.y).toBeCloseTo(50, 0);
    expect(box?.min.z).toBeCloseTo(0, 5);
    expect(box?.max.z).toBeCloseTo(60, 5);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const centre = new Vector3(0, 0, 30);
    let outward = 0;
    for (let i = 0; i < position.count; i++) {
      const p = new Vector3().fromBufferAttribute(position, i).sub(centre);
      const n = new Vector3().fromBufferAttribute(normal, i);
      if (p.dot(n) > 0) outward++;
    }
    // Normals face away from the middle (a cone's apex normals are the one fuzzy spot).
    expect(outward / position.count).toBeGreaterThan(0.97);
    expect(geometry.groups.some((g) => g.materialIndex === BODY)).toBe(true);
  });
});

/** How many of `edges`' segments stand upright (pairs of points, x y z each). */
const uprights = (edges: readonly number[]) =>
  edges.filter((_, i) => i % 6 === 2 && edges[i + 3] !== edges[i]).length;

test("a prism wears the card on its top, and only a sphere's edges wait for the selection", () => {
  const prism = solidGeometry(spec("rect", 60));
  expect(prism.geometry.groups[0]?.materialIndex).toBe(FACE);
  expect(solidGeometry(spec("sphere", 60)).geometry.groups.map((g) => g.materialIndex)).toEqual([
    BODY,
  ]);
  expect(solidGeometry(spec("sphere", 60)).edgesWhenSelected).toBe(true);
  // A diamond's four points are creases, drawn as uprights; a rounded box has none.
  expect(uprights(solidGeometry(spec("diamond", 60)).edges)).toBe(4);
  expect(uprights(prism.edges)).toBe(0);
});

test("a geometry is rebuilt exactly when what it is built from changes", () => {
  expect(solidKey(spec("rect", 60))).toBe(solidKey(spec("rect", 60)));
  expect(solidKey(spec("rect", 60))).not.toBe(solidKey(spec("rect", 61)));
  expect(solidKey(spec("rect", 60))).not.toBe(solidKey(spec("cone", 60)));
});
