/**
 * The canvas document round-trips: what kb reads it writes back, its own
 * extension fields (depth, camera) included, and anything it does not know
 * survives untouched. Absent depth and camera are today's 2D canvas.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  cameraLookingFrom,
  canvasDepth,
  paintOrder,
  posesAgree,
  parseCanvasDoc,
  projectionOf,
  stringifyCanvasDoc,
  withCanvasCamera,
  withDepth,
  type CanvasDoc,
  type CanvasNode,
} from "../src/index.ts";

const roundTrip = (doc: CanvasDoc) => parseCanvasDoc(stringifyCanvasDoc(doc));
const finite = fc
  .double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 })
  .map((v) => v + 0); // JSON has no -0

const nodeArb: fc.Arbitrary<CanvasNode> = fc
  .record({
    id: fc.string({ minLength: 1 }),
    x: finite,
    y: finite,
    width: fc.double({ noNaN: true, min: 1, max: 4000 }),
    height: fc.double({ noNaN: true, min: 1, max: 4000 }),
    z: fc.option(finite, { nil: undefined }),
    text: fc.string(),
  })
  .map(({ z, ...rest }) => ({ ...rest, type: "text" as const, ...(z === undefined ? {} : { z }) }));

const poseArb = fc.record({
  x: finite,
  y: finite,
  z: finite,
  zoom: fc.double({ noNaN: true, min: 0.01, max: 10 }),
  yaw: finite,
  pitch: finite,
});

const cameraArb = fc.record(
  { projection: fc.constantFrom("2d" as const, "3d" as const), pose: poseArb },
  { requiredKeys: ["projection"] },
);

/** A bare text item at depth `z`. */
const itemAt = (id: string, z?: number): CanvasNode => ({
  id,
  type: "text",
  text: "",
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  ...(z === undefined ? {} : { z }),
});

describe("depth", () => {
  test("any document with depths and a camera reads back as itself", () => {
    fc.assert(
      fc.property(
        fc.array(nodeArb, { maxLength: 8 }),
        fc.option(cameraArb, { nil: undefined }),
        (nodes, camera) => {
          const doc: CanvasDoc = { nodes, edges: [], ...(camera ? { camera } : {}) };
          expect(roundTrip(doc)).toEqual(doc);
        },
      ),
    );
  });

  test("a document without depth is written exactly as before", () => {
    const raw = {
      nodes: [{ id: "a", type: "text", x: 1, y: 2, width: 3, height: 4, text: "t" }],
      edges: [],
    };
    expect(JSON.parse(stringifyCanvasDoc(parseCanvasDoc(raw)))).toEqual(raw);
    expect(canvasDepth(parseCanvasDoc(raw).nodes[0] as CanvasNode)).toBe(0);
  });

  test("a depth kb cannot read is kept verbatim, and a depth set replaces it", () => {
    const raw = {
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "", z: "high" }],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    const item = doc.nodes[0] as CanvasNode;
    expect(canvasDepth(item)).toBe(0);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
    const lifted = withDepth(item, 30);
    expect(lifted).toMatchObject({ z: 30 });
    expect(lifted.extra).toBeUndefined();
    expect(withDepth(item, 0).extra).toBeUndefined();
  });

  test("depth survives on an item type kb does not know", () => {
    const raw = {
      nodes: [{ id: "f", type: "file", file: "a.md", x: 0, y: 0, width: 9, height: 9, z: -40 }],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes[0]?.z).toBe(-40);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
  });

  test("back on the plane, an item carries no depth at all", () => {
    const node: CanvasNode = { id: "a", type: "text", text: "", x: 0, y: 0, width: 1, height: 1 };
    const raised = withDepth(node, 120);
    expect(raised.z).toBe(120);
    expect("z" in withDepth(raised, 0)).toBe(false);
  });

  test("paint order is depth first, then document order", () => {
    const order = paintOrder([
      itemAt("a", 50),
      itemAt("b"),
      itemAt("c", -10),
      itemAt("d"),
      itemAt("e", 50),
    ]);
    expect(order.map((n) => n.id)).toEqual(["c", "b", "d", "a", "e"]);
  });
});

describe("camera", () => {
  test("no camera is 2D", () => {
    expect(projectionOf(parseCanvasDoc({ nodes: [], edges: [] }).camera)).toBe("2d");
  });

  test("a camera kb cannot read is kept verbatim, and a set camera replaces it", () => {
    const raw = { nodes: [], edges: [], camera: { projection: "vr", fov: 90 } };
    const doc = parseCanvasDoc(raw);
    expect(doc.camera).toBeUndefined();
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
    const set = withCanvasCamera(doc, { projection: "3d" });
    expect(JSON.parse(stringifyCanvasDoc(set))).toEqual({
      nodes: [],
      edges: [],
      camera: { projection: "3d" },
    });
  });

  test("unknown camera fields and an unreadable pose survive round-trip", () => {
    const raw = {
      nodes: [],
      edges: [],
      camera: { projection: "3d", pose: { x: 1 }, fov: 50 },
    };
    const doc = parseCanvasDoc(raw);
    expect(doc.camera?.projection).toBe("3d");
    expect(doc.camera?.pose).toBeUndefined();
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
  });

  test("a new pose wins over an unreadable one", () => {
    const doc = parseCanvasDoc({ nodes: [], edges: [], camera: { projection: "3d", pose: 7 } });
    const pose = { x: 1, y: 2, z: 3, zoom: 1, yaw: 0.2, pitch: 0.4 };
    const camera = { ...doc.camera, projection: "3d" as const, pose };
    expect(roundTrip(withCanvasCamera(doc, camera)).camera?.pose).toEqual(pose);
  });

  test("setting the camera a document already has is the same document", () => {
    const camera = { projection: "3d" as const };
    const doc = withCanvasCamera({ nodes: [], edges: [] }, camera);
    expect(withCanvasCamera(doc, camera)).toBe(doc);
    const flat = { nodes: [], edges: [] };
    expect(withCanvasCamera(flat, undefined)).toBe(flat);
  });

  test("clearing keeps a camera this version could not read", () => {
    const doc = parseCanvasDoc({ nodes: [], edges: [], camera: { projection: "vr" } });
    expect(withCanvasCamera(doc, undefined).extra?.camera).toEqual({ projection: "vr" });
  });

  test("a pose written supersedes one kb could not read", () => {
    const doc = parseCanvasDoc({ nodes: [], edges: [], camera: { projection: "3d", pose: 7 } });
    const pose = { x: 1, y: 2, z: 3, zoom: 1, yaw: 0.2, pitch: 0.4 };
    const camera = cameraLookingFrom(doc.camera, "2d", pose);
    expect(camera).toEqual({ projection: "2d", pose });
    expect(cameraLookingFrom(doc.camera, "2d").extra).toEqual({ pose: 7 });
  });

  test("two poses agree when nothing anyone could see differs", () => {
    const pose = { x: 100, y: 50, z: 0, zoom: 0.9, yaw: -0.3, pitch: 0.6 };
    expect(posesAgree(pose, { ...pose, x: 100.0001, zoom: 0.90000001 })).toBe(true);
    expect(posesAgree(pose, { ...pose, yaw: -0.31 })).toBe(false);
    expect(posesAgree(pose, undefined)).toBe(false);
    expect(posesAgree(undefined, undefined)).toBe(true);
  });

  test("clearing the camera leaves the document 2D", () => {
    const doc = withCanvasCamera({ nodes: [], edges: [] }, { projection: "3d" });
    expect(stringifyCanvasDoc(withCanvasCamera(doc, undefined))).toBe('{"nodes":[],"edges":[]}');
  });
});
