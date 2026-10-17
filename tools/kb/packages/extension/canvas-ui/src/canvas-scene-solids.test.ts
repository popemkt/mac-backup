/**
 * The mesh builders build what the shape table says: every shape, flat and
 * solid, fills exactly its box, faces outward, keeps its face on top, and
 * draws its edges as a diagram would.
 */
import { describe, expect, test } from "vitest";
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type BufferGeometry,
} from "three/webgpu";
import { CANVAS_SHAPES, type CanvasShapeKind } from "@kb/canvas";
import { BODY, FACE, solidGeometry, solidKey, type SolidSpec } from "./canvas-scene-solids";

const SHAPES = Object.keys(CANVAS_SHAPES) as CanvasShapeKind[];
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
    // Each triangle is wound and lit to face out of the solid: just off it is outside, just
    // behind it inside (a cone's apex triangles are the one fuzzy spot).
    // Every triangle of a prism; an evenly spread few hundred of a round solid's thousands.
    const all = trianglesOf(geometry);
    const stride = Math.ceil(all.length / 240);
    const triangles = all.filter((_, i) => i % stride === 0);
    const inside = insideOf(geometry);
    const outward = triangles.filter(
      ({ centre, facing, normal }) =>
        facing.dot(normal) > 0 &&
        !inside(centre.clone().addScaledVector(facing, 0.05)) &&
        inside(centre.clone().addScaledVector(facing, -0.05)),
    );
    expect(outward.length / triangles.length).toBeGreaterThan(0.97);
    expect(geometry.groups.some((g) => g.materialIndex === BODY)).toBe(true);
  });
});

/**
 * Each triangle of `geometry` with an area (a sphere's poles have none): its
 * centre, the way its winding faces, and the normal its vertices say it has.
 */
function trianglesOf(
  geometry: BufferGeometry,
): { centre: Vector3; facing: Vector3; normal: Vector3 }[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.index;
  const vertex = (i: number) => (index === null ? i : index.getX(i));
  return Array.from({ length: (index?.count ?? position.count) / 3 }, (_, t) => {
    const corners = [0, 1, 2].map((k) => vertex(t * 3 + k));
    const [a = new Vector3(), b = new Vector3(), c = new Vector3()] = corners.map((i) =>
      new Vector3().fromBufferAttribute(position, i),
    );
    const facing = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const n = corners
      .map((i) => new Vector3().fromBufferAttribute(normal, i))
      .reduce((sum, v) => sum.add(v), new Vector3())
      .normalize();
    const centre = new Vector3().add(a).add(b).add(c).divideScalar(3);
    return { centre, facing, normal: n };
  })
    .filter(({ facing }) => facing.length() > 1e-6)
    .map((t) => ({ ...t, facing: t.facing.normalize() }));
}

/** Askew rays, so most run along no side or seam; the inside is what most of them say. */
const RAYS = [
  new Vector3(0.31, 0.47, 0.83),
  new Vector3(-0.62, 0.19, 0.76),
  new Vector3(0.11, -0.71, -0.69),
].map((d) => d.normalize());

/** Whether a point lies inside the closed mesh `geometry`: a ray from it crosses its surface an odd number of times. */
function insideOf(geometry: BufferGeometry): (p: Vector3) => boolean {
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  return (p) =>
    RAYS.filter((dir) => new Raycaster(p, dir).intersectObject(mesh).length % 2 === 1).length >= 2;
}

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
