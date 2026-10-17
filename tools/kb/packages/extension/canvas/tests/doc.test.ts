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
  imageItem,
  isFileNode,
  isKbNode,
  isShapeNode,
  isTextNode,
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
import { CANVAS_LOOKS } from "../src/style-fields.ts";

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

/** A value no field codec reads: every field kb knows stays unread when it holds this. */
const UNREAD = [["unread"]];
/** A readable value of every optional field, as written: an item's, a line's and an edge's. */
const ITEM_SAMPLES: Record<string, unknown> = {
  z: 40,
  depth: 20,
  rotation: { z: 30 },
  color: "2",
  nodeId: "n.a",
  parent: "f",
  billboard: true,
  locked: true,
  style: { fill: "solid" },
};
const PATH_SAMPLES: Record<string, unknown> = { closed: true, fromHead: "dot", toHead: "bar" };
const EDGE_SAMPLES: Record<string, unknown> = {
  fromSide: "top",
  toSide: "left",
  fromEnd: "arrow",
  toEnd: "none",
  color: "4",
  label: "leads",
  kbLink: {
    mode: "layout",
    via: "prop",
    fieldId: "f",
    sourceNodeId: "a",
    targetNodeId: "b",
    bindingId: "k",
  },
  fromAnchor: { x: 0.25, y: 0 },
  toAnchor: { x: 1, y: 0.5 },
  route: "arc",
  bend: 12,
  fromHead: "open",
  toHead: "diamond",
  style: { dash: "dotted" },
};
const STYLE_SAMPLES: Record<string, unknown> = {
  fill: "semi",
  dash: "dashed",
  size: "xl",
  font: "mono",
  align: "end",
  valign: "bottom",
  opacity: 0.5,
};
const line = { id: "l", type: "path", x: 0, y: 0, width: 9, height: 9 };
const lineAt = {
  ...line,
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};
const card = { id: "a", type: "text", text: "", x: 0, y: 0, width: 1, height: 1 };

/** `stale` given `fresh`'s value of `key`, as an edit sets a field (a spread, not a setter). */
const given = <R extends object>(stale: R, fresh: R | undefined, key: string): R => ({
  ...stale,
  ...Object.fromEntries(Object.entries(fresh ?? {}).filter(([k]) => k === key)),
});

/**
 * The document `raw` describes twice — once holding `key` unread, once
 * holding it as `value` — the first given the second's value by `edit`, and
 * written back as JSON.
 */
function edited(
  raw: (held: unknown) => Record<string, unknown>,
  value: unknown,
  edit: (stale: CanvasDoc, fresh: CanvasDoc) => CanvasDoc,
) {
  const stale = parseCanvasDoc(raw(UNREAD));
  return JSON.parse(stringifyCanvasDoc(edit(stale, parseCanvasDoc(raw(value)))));
}

/** A doc's first item given `key` from another's: what the record says, written. */
const itemEdit = (key: string) => (stale: CanvasDoc, fresh: CanvasDoc) => ({
  ...stale,
  nodes: stale.nodes.map((n) => given(n, fresh.nodes[0], key)),
});

/** A 3D document whose camera's pose is `held`, and one given another's pose. */
const posed = (held: unknown) => ({ nodes: [], camera: { projection: "3d", pose: held } });
const posing = (stale: CanvasDoc, fresh: CanvasDoc) =>
  stale.camera === undefined
    ? stale
    : { ...stale, camera: given(stale.camera, fresh.camera, "pose") };
/** A document whose camera is `held`, and one given another's camera. */
const viewed = (held: unknown) => ({ nodes: [], camera: held });
const viewing = (stale: CanvasDoc, fresh: CanvasDoc) => given(stale, fresh, "camera");

describe("the record wins over what kb kept unread", () => {
  test.each(Object.entries(ITEM_SAMPLES))("item %s", (key, value) => {
    const raw = (held: unknown) => ({ nodes: [{ ...card, [key]: held }], edges: [] });
    expect(edited(raw, value, itemEdit(key)).nodes[0][key]).toEqual(value);
  });
  test.each(Object.entries(PATH_SAMPLES))("line %s", (key, value) => {
    const raw = (held: unknown) => ({ nodes: [{ ...lineAt, [key]: held }], edges: [] });
    expect(edited(raw, value, itemEdit(key)).nodes[0][key]).toEqual(value);
  });
  test.each(Object.entries(EDGE_SAMPLES))("edge %s", (key, value) => {
    const raw = (held: unknown) => ({
      nodes: [],
      edges: [{ id: "e", fromNode: "a", toNode: "b", [key]: held }],
    });
    const edit = (stale: CanvasDoc, fresh: CanvasDoc) => ({
      ...stale,
      edges: stale.edges.map((e) => given(e, fresh.edges[0], key)),
    });
    expect(edited(raw, value, edit).edges[0][key]).toEqual(value);
  });
  test.each(Object.entries(STYLE_SAMPLES))("look %s", (key, value) => {
    const raw = (held: unknown) => ({ nodes: [{ ...card, style: { [key]: held } }], edges: [] });
    const edit = (stale: CanvasDoc, fresh: CanvasDoc) => ({
      ...stale,
      nodes: stale.nodes.map((n) =>
        n.style === undefined ? n : { ...n, style: given(n.style, fresh.nodes[0]?.style, key) },
      ),
    });
    expect(edited(raw, value, edit).nodes[0].style[key]).toEqual(value);
  });
  test("the camera's pose, and the document's camera", () => {
    const pose = { x: 1, y: 2, z: 3, zoom: 1, yaw: 0, pitch: 0 };
    expect(edited(posed, pose, posing).camera.pose).toEqual(pose);
    const camera = { projection: "3d" };
    expect(edited(viewed, camera, viewing).camera).toEqual(camera);
  });
  test("every look is sampled", () => {
    expect(Object.keys(STYLE_SAMPLES).toSorted()).toEqual([...CANVAS_LOOKS].toSorted());
  });
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

  test("every field kb knows but cannot read is kept verbatim, on an item and an edge", () => {
    const raw = {
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "", color: 3, nodeId: 7 },
        { id: "b", type: "text", x: 0, y: 0, width: 1, height: 1, text: "", billboard: "yes" },
      ],
      edges: [
        {
          id: "e",
          fromNode: "a",
          toNode: "b",
          fromSide: "middle",
          toEnd: "triangle",
          label: 4,
          kbLink: { via: "query" },
        },
      ],
    };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes[0]?.color).toBeUndefined();
    expect(doc.edges[0]?.fromSide).toBeUndefined();
    expect(doc.edges[0]?.kbLink).toBeUndefined();
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
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
    // A card still needs its node: one without is not a card, but it is kept.
    const [orphan] = parseCanvasDoc({ nodes: [{ id: "k", type: "kb-node" }], edges: [] }).nodes;
    expect(orphan !== undefined && isKbNode(orphan)).toBe(false);
    expect(orphan?.id).toBe("k");
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

/** `value` as JSON says it: what a reader of the written document sees. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const KINDS = ["text", "group", "kb-node", "shape", "file", "path", "link", "x-future"];

describe("what kb cannot read survives any edit of what it can", () => {
  test("every key of any item, whatever its kind, is written back as it was", () => {
    const keyArb = fc.string().filter((key) => key !== "__proto__");
    fc.assert(
      fc.property(
        fc.constantFrom(...KINDS),
        fc.dictionary(keyArb, fc.jsonValue(), { maxKeys: 6 }),
        (type, more) => {
          const raw = asJson({ ...more, id: "a", type, x: 0, y: 0, width: 10, height: 10 });
          const [out] = JSON.parse(stringifyCanvasDoc(parseCanvasDoc({ nodes: [raw] }))).nodes;
          expect(out).toMatchObject(raw as object);
        },
      ),
    );
  });

  test("a kind keeps what only another kind reads, and one it cannot read keeps its kind's keys", () => {
    const raw = {
      nodes: [
        {
          id: "l",
          type: "link",
          url: "https://kb.test",
          label: "kb",
          x: 0,
          y: 0,
          width: 9,
          height: 9,
        },
        {
          id: "t",
          type: "text",
          text: "a",
          label: "kept",
          shape: "ellipse",
          x: 0,
          y: 0,
          width: 9,
          height: 9,
        },
        { id: "h", type: "shape", shape: "hexagon", label: "six", x: 0, y: 0, width: 9, height: 9 },
        { id: "n", type: "text", text: 5, x: 0, y: 0, width: 9, height: 9 },
      ],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes.map((n) => isShapeNode(n) || isTextNode(n))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
  });

  test("a record kb cannot place, and an edge without its ends, are kept through an edit", () => {
    const raw = {
      nodes: [
        { id: "a", type: "text", text: "a", x: 0, y: 0, width: 9, height: 9 },
        { id: "w", type: "text", text: "w", x: 0, y: 0, width: "wide", height: 9 },
        { type: "text", text: "no id" },
        "not an item",
      ],
      edges: [
        { id: "e", fromNode: "a", toNode: "w" },
        { id: "half", fromNode: "a" },
      ],
    };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(doc.edges.map((e) => e.id)).toEqual(["e"]);
    const moved = { ...doc, nodes: doc.nodes.map((n) => ({ ...n, x: 40 })) };
    const written = JSON.parse(stringifyCanvasDoc(moved));
    expect(written.nodes.slice(1)).toEqual(raw.nodes.slice(1));
    expect(written.edges).toEqual(raw.edges);
    expect(written.nodes[0].x).toBe(40);
  });
});

describe("images", () => {
  test("a file item is typed by its file, and its subpath round-trips untouched", () => {
    const raw = {
      nodes: [
        {
          id: "i",
          type: "file",
          file: "assets/01ABC.png",
          subpath: "#x",
          x: 1,
          y: 2,
          width: 3,
          height: 4,
        },
      ],
      edges: [],
    };
    const [image] = parseCanvasDoc(raw).nodes;
    expect(image !== undefined && isFileNode(image) ? image.file : null).toBe("assets/01ABC.png");
    expect(JSON.parse(stringifyCanvasDoc(parseCanvasDoc(raw)))).toEqual(raw);
  });

  test("an image is placed centred, at its own aspect, its longer side no longer than the preset's", () => {
    const wide = imageItem("assets/w.png", { x: 500, y: 300 }, "w", { width: 1600, height: 900 });
    expect(wide).toMatchObject({ type: "file", file: "assets/w.png", width: 320, height: 180 });
    expect(wide).toMatchObject({ x: 340, y: 210 });
    // Never larger than the picture itself; unknown, the preset's box.
    expect(imageItem("assets/s.png", { x: 0, y: 0 }, "s", { width: 40, height: 30 })).toMatchObject(
      {
        width: 40,
        height: 30,
      },
    );
    expect(imageItem("assets/u.svg", { x: 0, y: 0 }, "u")).toMatchObject({
      width: 320,
      height: 240,
    });
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
