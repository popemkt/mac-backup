/**
 * The canvas document round-trips: what kb reads it writes back, its own
 * extension fields (elevation, depth, shape, camera) included, and anything
 * it does not know survives untouched. Absent elevation, depth and camera
 * are a flat 2D canvas. The shape table and the presets over it are pure
 * data, proved here too.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  CANVAS_SHAPES,
  CANVAS_SOLID_PRESETS,
  cameraLookingFrom,
  canvasDepth,
  canvasElevation,
  canvasTop,
  itemShape,
  onFootprint,
  paintOrder,
  presetItem,
  shapeOutline,
  svgPathData,
  withDepth,
  posesAgree,
  parseCanvasDoc,
  projectionOf,
  stringifyCanvasDoc,
  withCanvasCamera,
  withElevation,
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
    depth: fc.option(fc.double({ noNaN: true, min: 0, max: 4000 }), { nil: undefined }),
    look: fc.oneof(
      fc.record({ type: fc.constant("text" as const), text: fc.string() }),
      fc.record({
        type: fc.constant("shape" as const),
        shape: fc.constantFrom("rect", "ellipse", "diamond", "sphere", "cone" as const),
      }),
    ),
  })
  .map(({ z, depth, look, ...rest }) => ({
    ...rest,
    ...look,
    ...(z === undefined ? {} : { z }),
    ...(depth === undefined ? {} : { depth: depth + 0 }),
  }));

const poseArb = fc.record(
  {
    x: finite,
    y: finite,
    z: finite,
    zoom: fc.double({ noNaN: true, min: 0.01, max: 10 }),
    yaw: finite,
    pitch: finite,
    fov: fc.double({ noNaN: true, min: 0, max: 120 }),
  },
  { requiredKeys: ["x", "y", "z", "zoom", "yaw", "pitch"] },
);

const cameraArb = fc.record(
  { projection: fc.constantFrom("2d" as const, "3d" as const), pose: poseArb },
  { requiredKeys: ["projection"] },
);

/** A bare text item at elevation `z`, rising `depth`. */
const itemAt = (id: string, z?: number, depth?: number): CanvasNode => ({
  id,
  type: "text",
  text: "",
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  ...(z === undefined ? {} : { z }),
  ...(depth === undefined ? {} : { depth }),
});

describe("elevation and depth", () => {
  test("any document of flat items and solids, with a camera, reads back as itself", () => {
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
    expect(canvasElevation(parseCanvasDoc(raw).nodes[0] as CanvasNode)).toBe(0);
  });

  test("a depth kb cannot read is kept verbatim, and a depth set replaces it", () => {
    const raw = {
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "", z: "high" }],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    const item = doc.nodes[0] as CanvasNode;
    expect(canvasElevation(item)).toBe(0);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
    const lifted = withElevation(item, 30);
    expect(lifted).toMatchObject({ z: 30 });
    expect(lifted.extra).toBeUndefined();
    expect(withElevation(item, 0).extra).toBeUndefined();
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

  test("any item may carry the node it means, whatever it looks like", () => {
    const raw = {
      nodes: [
        { id: "s", type: "shape", x: 0, y: 0, width: 9, height: 9, nodeId: "n.a", shape: "rect" },
        { id: "t", type: "text", x: 0, y: 0, width: 9, height: 9, nodeId: "n.b", text: "hi" },
        { id: "f", type: "file", file: "a.md", x: 0, y: 0, width: 9, height: 9, nodeId: "n.c" },
        { id: "k", type: "kb-node", x: 0, y: 0, width: 9, height: 9, nodeId: "n.d" },
      ],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes.map((n) => n.nodeId)).toEqual(["n.a", "n.b", "n.c", "n.d"]);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
    // A card still needs its node: one without is not a card.
    expect(parseCanvasDoc({ nodes: [{ id: "k", type: "kb-node" }], edges: [] }).nodes).toEqual([]);
  });

  test("back on the plane, an item carries no depth at all", () => {
    const node: CanvasNode = { id: "a", type: "text", text: "", x: 0, y: 0, width: 1, height: 1 };
    const raised = withElevation(node, 120);
    expect(raised.z).toBe(120);
    expect("z" in withElevation(raised, 0)).toBe(false);
  });

  test("paint order is the top surface's height first, then document order", () => {
    const order = paintOrder([
      itemAt("a", 50),
      itemAt("b"),
      itemAt("c", -10),
      itemAt("d"),
      itemAt("e", 50),
      // Standing on the floor, a block 80 tall tops a card raised to 50.
      itemAt("f", 0, 80),
    ]);
    expect(order.map((n) => n.id)).toEqual(["c", "b", "d", "a", "e", "f"]);
  });

  test("extruding sets depth and nothing else; flat again, the item is as it was", () => {
    const sticky = itemAt("s", 30);
    const block = withDepth(sticky, 60);
    expect(block).toEqual({ ...sticky, depth: 60 });
    expect([canvasElevation(block), canvasDepth(block), canvasTop(block)]).toEqual([30, 60, 90]);
    expect(withDepth(block, 0)).toEqual(sticky);
    // There is no negative depth: an item sunk below its base is flat.
    expect(withDepth(sticky, -5)).toEqual(sticky);
    expect(canvasDepth({ ...sticky, depth: -5 })).toBe(0);
  });

  test("a depth kb cannot read stays verbatim beside an elevation it can", () => {
    const raw = {
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "", z: 4, depth: "x" },
      ],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes[0]?.z).toBe(4);
    expect(canvasDepth(doc.nodes[0] as CanvasNode)).toBe(0);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
    expect(withDepth(doc.nodes[0] as CanvasNode, 10).extra).toBeUndefined();
  });

  test("a solid's shape and depth survive a round trip", () => {
    const raw = {
      nodes: [
        { id: "b", type: "shape", x: 0, y: 0, width: 80, height: 80, depth: 40, shape: "sphere" },
        { id: "c", type: "shape", x: 0, y: 0, width: 80, height: 80, depth: 90, shape: "cone" },
      ],
      edges: [],
    };
    expect(JSON.parse(stringifyCanvasDoc(parseCanvasDoc(raw)))).toEqual(raw);
  });
});

describe("shapes and presets", () => {
  test("every item is a box its shape fills; a card or a frame is a rectangle", () => {
    expect(itemShape(itemAt("t"))).toBe("rect");
    expect(itemShape(presetItem("sphere", { x: 0, y: 0 }, "s"))).toBe("sphere");
    expect(Object.values(CANVAS_SHAPES).map((spec) => spec.volume)).toEqual([
      "prism",
      "prism",
      "prism",
      "ellipsoid",
      "cone",
    ]);
  });

  test("a footprint is what its outline encloses", () => {
    // Corners of the box are off every footprint but the rectangle's.
    expect(onFootprint("rect", 0.95, 0.95)).toBe(true);
    expect(onFootprint("ellipse", 0.95, 0.95)).toBe(false);
    expect(onFootprint("diamond", 0.6, 0.6)).toBe(false);
    expect(onFootprint("sphere", 0.7, 0.7)).toBe(true);
    expect(onFootprint("cone", 0, 0.99)).toBe(true);
    // The outline passes through each side's midpoint, where edges anchor.
    for (const shape of ["rect", "ellipse", "diamond", "sphere", "cone"] as const) {
      const d = svgPathData(shapeOutline(shape, 100, 60, 8));
      expect(d.startsWith("M "), shape).toBe(true);
      expect(d.endsWith("Z"), shape).toBe(true);
    }
    expect(svgPathData(shapeOutline("diamond", 100, 60, 8))).toBe(
      "M 50 0 L 100 30 L 50 60 L 0 30 Z",
    );
  });

  test("the solid presets are exactly the presets with depth, in the table's order", () => {
    expect(CANVAS_SOLID_PRESETS).toEqual(["box", "pillar", "sphere", "cone", "slab", "wall"]);
    for (const preset of CANVAS_SOLID_PRESETS) {
      expect(canvasDepth(presetItem(preset, { x: 0, y: 0 }, preset)), preset).toBeGreaterThan(0);
    }
    // A shelf is raised off the floor to stand things on; everything else stands on it.
    expect(canvasElevation(presetItem("slab", { x: 0, y: 0 }, "s"))).toBeGreaterThan(0);
    expect(canvasElevation(presetItem("box", { x: 0, y: 0 }, "b"))).toBe(0);
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
    expect(posesAgree({ ...pose, fov: 34 }, { ...pose, fov: 0 })).toBe(false);
    expect(posesAgree({ ...pose, fov: 34 }, pose)).toBe(false);
  });

  test("a pose keeps its lens, and one it cannot read is no lens at all", () => {
    const pose = { x: 1, y: 2, z: 3, zoom: 1, yaw: 0.2, pitch: 0.4, fov: 0 };
    const doc = { nodes: [], edges: [], camera: { projection: "3d" as const, pose } };
    expect(roundTrip(doc).camera?.pose).toEqual(pose);
    const unread = parseCanvasDoc({
      ...doc,
      camera: { projection: "3d", pose: { ...pose, fov: -4 } },
    });
    expect(unread.camera?.pose).toEqual({ x: 1, y: 2, z: 3, zoom: 1, yaw: 0.2, pitch: 0.4 });
  });

  test("clearing the camera leaves the document 2D", () => {
    const doc = withCanvasCamera({ nodes: [], edges: [] }, { projection: "3d" });
    expect(stringifyCanvasDoc(withCanvasCamera(doc, undefined))).toBe('{"nodes":[],"edges":[]}');
  });
});
