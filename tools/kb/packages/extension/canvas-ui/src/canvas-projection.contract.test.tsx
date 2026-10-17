/**
 * The canvas projection contract (DESIGN-UI.md → Canvas → Projections): what
 * every projection in `CANVAS_PROJECTIONS` promises about one document, proved
 * over each of them with the view that projection holds.
 *
 * - it draws every item once, back to front in paint order;
 * - it draws every edge whose two ends exist, and no other (how it runs
 *   and what it wears: the look contract, `canvas-look.contract.test.tsx`);
 * - it marks exactly the shared selection;
 * - every item's face is drawn where the one camera model projects it: the
 *   corners of the plane its face lies on (`faceShare`), turned with the
 *   item, over its paint plane (`paintPlanes`);
 * - what is drawn on top at a point — in the DOM the topmost card whose
 *   footprint (its clip path, which the browser both paints and hit-tests
 *   by) covers it, in the scene the first drawn surface a ray meets — is
 *   what the model's `hitTest` finds there, for raised, sunk and same-height
 *   overlapping cards and for every solid, from oblique orbits, low across
 *   the floor and through either lens;
 * - footprint parity: over a grid across every item's box, inside its
 *   footprint and in its corners outside it, both of the above agree with
 *   the model, so what 2D draws and hit-tests is each solid's top view —
 *   for turned items too, flat and solid, spun about z and tilted;
 * - a card moved and turned in the document is drawn where it went;
 * - a set moved in the paint order (`orderItems`) is drawn back to front in
 *   its new order and hit where it now paints on top; a set mirrored
 *   (`flipItems`) is drawn where the mirror put it; a locked item is drawn
 *   and hit as any other, since a lock holds an item and is no look;
 * - nested membership: a frame paints under what belongs to it, at any
 *   depth and whatever the document order, and a frame's transform draws
 *   its members where it carried them;
 * - an item's anchor, where a script's drawing stands on it
 *   (`itemScreenRects`), holds every corner of its face as drawn, and a
 *   flat item's face fills it;
 * - a comment thread's pin (`threadPins`) stands at the top right of each
 *   item it is pinned on as drawn — through its node on every card showing
 *   it, or on the item — or where its point is drawn, and nowhere once its
 *   pin is lost.
 *
 * The 2D projection is the real DOM stage; the 3D one is the real scene on
 * the GPU stand-ins (`@kb/ui-test-kit`), each read by its probe
 * (`test-support/projection-probes.ts`). A projection joins by its
 * registration: the probe table must list exactly the registry. What each
 * draws of an item's look is the look contract's (`canvas-look.contract`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  boxFrame,
  boxToLocal,
  canvasDepth,
  boxToWorld,
  carriedBy,
  directionToLocal,
  flipItems,
  faceShare,
  facesCamera,
  frameCorners,
  itemFrame,
  itemShape,
  onFootprint,
  orderItems,
  paintOrder,
  planeCorners,
  selectionPivot,
  stillAbout,
  transformCarried,
  turnAbout,
  withFlag,
  type CanvasDoc,
  type CanvasNode,
  type CanvasShapeKind,
  type CommentAnchor,
} from "@kb/canvas";
import {
  cameraPose,
  hitTest,
  paintPlanes,
  projectPoint,
  screenToPlane,
  viewAxes,
  type CanvasView,
  type ScreenRect,
  type ViewSize,
} from "./canvas-camera";
import type { CanvasSelection } from "./canvas-selection";
import { syncUiPlugins } from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import { CANVAS_PROJECTIONS, canvasProjection } from "./canvas-projections";
import { itemScreenRects, threadPins } from "./canvas-visible";
import { PROBES, PROBE_LOOK, useProbePage } from "./test-support/projection-probes";

type Probe = Awaited<ReturnType<(typeof PROBES)["2d"]>>;
import type * as ThreeWebGpu from "three/webgpu";

// The canvas reaches the page only through its host: here, a test host.
beforeAll(() => syncUiPlugins([testHostPlugin(testBrowserHost())]));
afterAll(() => syncUiPlugins([]));

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  ...(await import("@kb/ui-test-kit")).FAKE_WEBGPU,
}));

/** A shape item of `shape`, before it has an id or a place. */
const solid = (shape: CanvasShapeKind) => ({ type: "shape" as const, shape, label: shape });

const doc: CanvasDoc = {
  nodes: [
    { id: "frame", type: "group", label: "Frame", x: -40, y: -40, width: 720, height: 260 },
    {
      id: "low",
      type: "text",
      text: "on the plane",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      parent: "frame",
    },
    {
      id: "twin",
      type: "text",
      text: "same depth",
      x: 60,
      y: 50,
      width: 200,
      height: 100,
      parent: "frame",
    },
    // Nested membership, written before the groups it belongs to: each paints over its group.
    {
      id: "held",
      type: "text",
      text: "held",
      x: 50,
      y: 745,
      width: 120,
      height: 60,
      parent: "nest",
    },
    {
      id: "nest",
      type: "group",
      label: "Nest",
      x: 20,
      y: 720,
      width: 200,
      height: 120,
      parent: "late",
    },
    { id: "late", type: "group", label: "Late", x: 0, y: 700, width: 320, height: 200 },
    { id: "raised", type: "text", text: "raised", x: 150, y: 40, width: 200, height: 100, z: 80 },
    {
      id: "sunk",
      type: "shape",
      shape: "rect",
      label: "sunk",
      x: 450,
      y: 0,
      width: 160,
      height: 90,
      z: -30,
    },
    { id: "gone", type: "kb-node", nodeId: "no.such.node", x: 700, y: 150, width: 180, height: 60 },
    // Solids, and a flat shape whose box corners are open canvas.
    {
      id: "block",
      type: "text",
      text: "a block",
      x: 40,
      y: 260,
      width: 160,
      height: 90,
      depth: 60,
    },
    { id: "ball", ...solid("sphere"), x: 260, y: 250, width: 120, height: 120, depth: 120 },
    { id: "cone", ...solid("cone"), x: 420, y: 250, width: 110, height: 110, depth: 140 },
    { id: "pillar", ...solid("ellipse"), x: 580, y: 250, width: 70, height: 70, depth: 180 },
    { id: "gem", ...solid("diamond"), x: 560, y: 360, width: 120, height: 90, depth: 40 },
    { id: "disc", ...solid("ellipse"), x: 690, y: 260, width: 140, height: 80 },
    { id: "slab", ...solid("rect"), x: -200, y: 120, width: 160, height: 80, z: 100, depth: 12 },
    // Turned items, apart from the rest: spun about z, and tilted, flat and solid.
    {
      id: "spun",
      type: "text",
      text: "spun",
      x: 0,
      y: 540,
      width: 160,
      height: 90,
      rotation: { z: 30 },
    },
    {
      id: "tipped",
      type: "text",
      text: "tipped",
      x: 230,
      y: 540,
      width: 140,
      height: 80,
      z: 40,
      rotation: { x: 50, z: 20 },
    },
    {
      id: "crate",
      ...solid("rect"),
      x: 440,
      y: 540,
      width: 100,
      height: 80,
      depth: 60,
      rotation: { z: 25 },
    },
    {
      id: "leaning",
      ...solid("rect"),
      x: 640,
      y: 540,
      width: 110,
      height: 70,
      depth: 50,
      z: 20,
      rotation: { x: 30, y: -20, z: 15 },
    },
    {
      id: "orb",
      ...solid("sphere"),
      x: 840,
      y: 530,
      width: 100,
      height: 80,
      depth: 90,
      rotation: { x: 40, y: 25 },
    },
    // Billboards, apart: a label turned (which it does not show: it faces the camera), and a
    // raised one; a solid billboard keeps its body's turn.
    {
      id: "tag",
      type: "text",
      text: "tag",
      x: 1200,
      y: 250,
      width: 140,
      height: 50,
      billboard: true,
      rotation: { x: 30, z: 40 },
    },
    {
      id: "sign",
      type: "text",
      text: "sign",
      x: 1200,
      y: 420,
      width: 120,
      height: 60,
      z: 60,
      billboard: true,
    },
    {
      id: "post",
      ...solid("rect"),
      x: 1220,
      y: 560,
      width: 60,
      height: 60,
      depth: 90,
      billboard: true,
      rotation: { z: 20 },
    },
    {
      id: "spire",
      ...solid("cone"),
      x: 1020,
      y: 530,
      width: 90,
      height: 90,
      depth: 120,
      rotation: { y: 35, z: 10 },
    },
  ],
  edges: [
    { id: "e1", fromNode: "low", toNode: "raised", toEnd: "arrow" },
    { id: "e2", fromNode: "raised", toNode: "sunk", fromSide: "right", toSide: "top" },
    { id: "dangling", fromNode: "low", toNode: "nowhere" },
  ],
};
const selection: CanvasSelection = { nodeIds: new Set(["raised"]), edgeIds: new Set(["e2"]) };
const size: ViewSize = { width: 1000, height: 700 };
const scene = { doc, selection, size, look: PROBE_LOOK };
/**
 * The views each projection is handed, and holds its own way: a desk tilt,
 * an oblique turn, low across the floor from the far side, and an oblique
 * turn through the orthographic lens.
 */
const ASKED: readonly CanvasView[] = [
  { x: 300, y: 80, z: 0, zoom: 0.8, yaw: -0.35, pitch: 0.5, fov: 34 },
  { x: 300, y: 80, z: 0, zoom: 0.7, yaw: 1.05, pitch: 1.1, fov: 34 },
  { x: 300, y: 80, z: 0, zoom: 0.8, yaw: Math.PI - 0.45, pitch: 1.3, fov: 34 },
  { x: 300, y: 80, z: 0, zoom: 0.8, yaw: 0.7, pitch: 0.9, fov: 0 },
];
/** Points where cards overlap, on the plane between them: raised over low, twin over low. */
const OVERLAPS = [
  { x: 175, y: 70, z: 40 },
  { x: 100, y: 75, z: 0 },
];

/**
 * Whether the ray through `p` meets some rectangle where its corner is
 * rounded: a look both projections draw (`cornerRadius`) and the model
 * treats as square, so a point there may fall either way.
 */
function atRoundedCorner(view: CanvasView, p: { x: number; y: number }): boolean {
  const floor = screenToPlane(view, size, p, -400);
  const from = view.fov > 0 ? cameraPose(view, size).eye : screenToPlane(view, size, p, 4000);
  if (floor === null || from === null) return false;
  const ray = { x: floor.x - from.x, y: floor.y - from.y, z: floor.z - from.z };
  return paintPlanes(paintOrder(doc.nodes)).some(({ item, z }) => {
    if (itemShape(item) !== "rect") return false;
    // In the box's own frame it is centred on the origin along its own axes.
    const frame = boxFrame(item, z);
    const o = boxToLocal(frame, from);
    const d = directionToLocal(frame, ray);
    const origin = [o.x, o.y, o.z] as const;
    const dir = [d.x, d.y, d.z] as const;
    const half = [frame.half.x, frame.half.y, frame.half.z] as const;
    let enter = -Infinity;
    let exit = Infinity;
    for (const i of [0, 1, 2] as const) {
      const a = (-half[i] - origin[i]) / dir[i];
      const b = (half[i] - origin[i]) / dir[i];
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
    if (enter > exit) return false;
    const x = origin[0] + dir[0] * enter;
    const y = origin[1] + dir[1] * enter;
    return half[0] - Math.abs(x) < CORNER && half[1] - Math.abs(y) < CORNER;
  });
}

/** Wider than any corner radius a card or a shape is drawn with, canvas units. */
const CORNER = 24;

/**
 * Points across every item's box, at half its height: on its footprint and
 * in the corners of its box off it, kept clear of the footprint's outline,
 * which a mesh only approximates.
 */
const footprintSamples = doc.nodes.flatMap((item) => {
  // Off the round numbers, so no sample sits on another item's edge.
  const steps = [-0.77, -0.37, 0.03, 0.43, 0.81];
  return steps.flatMap((u) =>
    steps.flatMap((v) => {
      const near = [0.1, -0.1].some(
        (d) =>
          onFootprint(itemShape(item), u * (1 + d), v * (1 + d)) !==
          onFootprint(itemShape(item), u, v),
      );
      if (near) return [];
      // Halfway up the box, in its own frame, turned with it.
      const frame = boxFrame(item);
      return [boxToWorld(frame, { x: u * frame.half.x, y: v * frame.half.y, z: 0 })];
    }),
  );
});

/** An item's face corners over the paint plane `z`, clockwise from the top left. */
const cornersOf = (item: CanvasNode, z: number, view: CanvasView) =>
  facesCamera(item)
    ? frameCorners(itemFrame(item, viewAxes(view), z)).slice(0, 4)
    : planeCorners(item, faceShare(item), z);

const centreOf = (item: CanvasNode) => ({
  x: item.x + item.width / 2,
  y: item.y + item.height / 2,
  z: item.z ?? 0,
});

/**
 * Whether `probe` draws `shown` as the model says: every item once, back to
 * front, each face where the camera model projects it, and on top at every
 * item's centre and at the overlaps what the model's hit test finds.
 */
function expectDrawnAsModel(probe: Probe, shown: CanvasDoc, view: CanvasView): void {
  const order = paintOrder(shown.nodes);
  expect(probe.drawn()).toEqual(order.map((n) => n.id));
  for (const { item, z } of paintPlanes(order)) {
    const drawn = probe.cornersOf(item.id);
    cornersOf(item, z, view).forEach((corner, i) => {
      const model = projectPoint(view, size, corner);
      expect(drawn?.[i]?.x, `${item.id} corner ${i}`).toBeCloseTo(model?.x ?? Number.NaN, 1);
      expect(drawn?.[i]?.y, `${item.id} corner ${i}`).toBeCloseTo(model?.y ?? Number.NaN, 1);
    });
  }
  const points = [...shown.nodes.map(centreOf), ...OVERLAPS]
    .map((p) => projectPoint(view, size, p))
    .filter((p) => p !== null);
  for (const at of points) {
    expect(probe.topAt(at), `at ${at.x.toFixed(0)},${at.y.toFixed(0)}`).toBe(
      hitTest(order, view, size, at),
    );
  }
}

/**
 * Whether `at`, an item's anchor, holds every corner of its face as `drawn`
 * — within a pixel, since the anchor is the item at its own height and its
 * face is drawn a hair over it — and, for a flat item, is filled by it.
 */
function expectAnchoredWhereDrawn(
  item: CanvasNode,
  drawn: readonly { x: number; y: number }[],
  at: ScreenRect | undefined,
): void {
  expect(at, item.id).toBeDefined();
  if (at === undefined) return;
  const xs = drawn.map((p) => p.x);
  const ys = drawn.map((p) => p.y);
  const sides = [
    [Math.min(...xs), at.left],
    [Math.max(...xs), at.right],
    [Math.min(...ys), at.top],
    [Math.max(...ys), at.bottom],
  ] as const;
  const [left, right, top, bottom] = sides;
  expect(left[0], `${item.id} left`).toBeGreaterThan(left[1] - 1);
  expect(right[0], `${item.id} right`).toBeLessThan(right[1] + 1);
  expect(top[0], `${item.id} top`).toBeGreaterThan(top[1] - 1);
  expect(bottom[0], `${item.id} bottom`).toBeLessThan(bottom[1] + 1);
  if (canvasDepth(item) > 0) return;
  for (const [face, anchor] of sides) {
    expect(Math.abs(face - anchor), `${item.id} fills`).toBeLessThan(1);
  }
}

/** An open thread `id` with no replies, pinned at `anchor`. */
const thread = (id: string, anchor: CommentAnchor) => ({
  id,
  text: id,
  canvas: "canvas",
  anchor,
  resolved: false,
  replies: [],
});

describe("canvas projection contract", () => {
  useProbePage();

  it("proves every registered projection", () => {
    expect(Object.keys(PROBES).toSorted()).toEqual(
      CANVAS_PROJECTIONS.map((p) => p.kind).toSorted(),
    );
  });

  const cases = CANVAS_PROJECTIONS.flatMap((p) =>
    ASKED.map((asked, i) => [`${p.kind}, view ${i + 1}`, p.kind, asked] as const),
  );
  describe.each(cases)("%s", (_name, kind, asked) => {
    const view = canvasProjection(kind).settle(asked);
    const mount = PROBES[kind];

    it("draws every item once, back to front", async () => {
      const probe = await mount(view, scene);
      expect(probe.drawn()).toEqual(paintOrder(doc.nodes).map((n) => n.id));
      probe.dispose();
    });

    it("draws every edge whose two ends exist, and no other", async () => {
      const probe = await mount(view, scene);
      expect(probe.edges().toSorted()).toEqual(["e1", "e2"]);
      probe.dispose();
    });

    it("marks exactly the selection", async () => {
      const probe = await mount(view, scene);
      expect(probe.selected().toSorted()).toEqual(["e2", "raised"]);
      probe.dispose();
    });

    it("draws every item's face where the model projects it, turned, over its paint plane", async () => {
      const probe = await mount(view, scene);
      for (const { item, z } of paintPlanes(paintOrder(doc.nodes))) {
        const drawn = probe.cornersOf(item.id);
        expect(drawn, item.id).not.toBeNull();
        cornersOf(item, z, view).forEach((corner, i) => {
          const model = projectPoint(view, size, corner);
          expect(drawn?.[i]?.x, `${item.id} corner ${i}`).toBeCloseTo(model?.x ?? Number.NaN, 1);
          expect(drawn?.[i]?.y, `${item.id} corner ${i}`).toBeCloseTo(model?.y ?? Number.NaN, 1);
        });
      }
      probe.dispose();
    });

    it("anchors every item where it draws it: its face within, a flat face filling it", async () => {
      const probe = await mount(view, scene);
      const anchors = itemScreenRects(doc.nodes, view, size);
      for (const item of doc.nodes) {
        expectAnchoredWhereDrawn(item, probe.cornersOf(item.id) ?? [], anchors.get(item.id));
      }
      probe.dispose();
    });

    it("pins each comment thread at the top right of what it is on as drawn, or at its point", async () => {
      const probe = await mount(view, scene);
      const at = { x: 300, y: 600 };
      const pins = threadPins(
        [
          thread("on-node", { node: "no.such.node" }),
          thread("on-item", { item: "raised" }),
          thread("at", { at }),
          thread("lost", { item: "no.such.item" }),
        ],
        doc,
        view,
        size,
      );
      expect(pins.map((pin) => [pin.thread.id, pin.item])).toEqual([
        ["on-node", "gone"],
        ["on-item", "raised"],
        ["at", null],
      ]);
      for (const pin of pins) {
        const drawn = pin.item === null ? [] : (probe.cornersOf(pin.item) ?? []);
        const tip =
          pin.item === null
            ? projectPoint(view, size, { ...at, z: 0 })
            : { x: Math.max(...drawn.map((p) => p.x)), y: Math.min(...drawn.map((p) => p.y)) };
        expect(Math.abs(pin.at.x - (tip?.x ?? Number.NaN)), `${pin.thread.id} x`).toBeLessThan(1);
        expect(Math.abs(pin.at.y - (tip?.y ?? Number.NaN)), `${pin.thread.id} y`).toBeLessThan(1);
      }
      probe.dispose();
    });

    it("draws on top at every point what the model's hit test finds there", async () => {
      const probe = await mount(view, scene);
      const order = paintOrder(doc.nodes);
      const points = [...doc.nodes.map(centreOf), ...OVERLAPS]
        .map((p) => projectPoint(view, size, p))
        .filter((p) => p !== null);
      for (const at of points) {
        expect(probe.topAt(at), `at ${at.x.toFixed(0)},${at.y.toFixed(0)}`).toBe(
          hitTest(order, view, size, at),
        );
      }
      probe.dispose();
    });

    it("draws and hits each item's top view: its footprint, not its box", async () => {
      const probe = await mount(view, scene);
      const order = paintOrder(doc.nodes);
      const points = footprintSamples
        .map((p) => projectPoint(view, size, p))
        .filter((p) => p !== null)
        .filter((p) => !atRoundedCorner(view, p));
      expect(points.length).toBeGreaterThan(200);
      for (const at of points) {
        expect(probe.topAt(at), `at ${at.x.toFixed(1)},${at.y.toFixed(1)}`).toBe(
          hitTest(order, view, size, at),
        );
      }
      probe.dispose();
    });

    it("draws a frame's members where the frame's transform carried them", async () => {
      const probe = await mount(view, scene);
      const carried = carriedBy(doc.nodes, ["late"]);
      const t = {
        ...stillAbout(selectionPivot(carried.items)),
        move: { x: 60, y: -20, z: 30 },
        turn: turnAbout({ x: 0, y: 0, z: 1 }, Math.PI / 6),
      };
      const moved = transformCarried(doc, carried, t);
      await probe.update(moved);
      const planes = paintPlanes(paintOrder(moved.nodes));
      expect(probe.drawn()).toEqual(paintOrder(moved.nodes).map((n) => n.id));
      for (const id of ["late", "nest", "held"]) {
        const plane = planes.find((p) => p.item.id === id);
        expect(plane, id).toBeDefined();
        if (plane === undefined) continue;
        const drawn = probe.cornersOf(id);
        cornersOf(plane.item, plane.z, view).forEach((corner, i) => {
          const model = projectPoint(view, size, corner);
          expect(drawn?.[i]?.x, `${id} corner ${i}`).toBeCloseTo(model?.x ?? Number.NaN, 1);
          expect(drawn?.[i]?.y, `${id} corner ${i}`).toBeCloseTo(model?.y ?? Number.NaN, 1);
        });
      }
      // What is on top over the carried member is what the model finds there.
      const held = moved.nodes.find((n) => n.id === "held");
      const at = held === undefined ? null : projectPoint(view, size, centreOf(held));
      expect(at).not.toBeNull();
      if (at !== null) {
        expect(probe.topAt(at)).toBe(hitTest(paintOrder(moved.nodes), view, size, at));
      }
      probe.dispose();
    });

    it("draws a set moved in the paint order in its new order, and hits what is now on top", async () => {
      const probe = await mount(view, scene);
      // low is under twin where they overlap; brought to the front, it is over it.
      const ordered = orderItems(doc, ["low"], "front");
      await probe.update(ordered);
      expectDrawnAsModel(probe, ordered, view);
      const behind = orderItems(doc, ["raised", "twin"], "back");
      await probe.update(behind);
      expectDrawnAsModel(probe, behind, view);
      probe.dispose();
    });

    it("draws a mirrored set where the mirror put it", async () => {
      const probe = await mount(view, scene);
      for (const axis of ["x", "y"] as const) {
        const flipped = flipItems(doc, ["spun", "tipped", "sunk", "raised"], axis);
        await probe.update(flipped);
        expectDrawnAsModel(probe, flipped, view);
      }
      probe.dispose();
    });

    it("draws and hits a locked item as any other: a lock is no look", async () => {
      const probe = await mount(view, scene);
      const held = new Set(["raised", "twin", "ball", "late"]);
      const locked = {
        ...doc,
        nodes: doc.nodes.map((n) => (held.has(n.id) ? withFlag(n, "locked", true) : n)),
      };
      await probe.update(locked);
      expectDrawnAsModel(probe, locked, view);
      probe.dispose();
    });

    it("draws a moved and turned card where it went", async () => {
      const probe = await mount(view, scene);
      const moved = doc.nodes.map((n) =>
        n.id === "sunk" ? { ...n, x: n.x + 120, z: 40, rotation: { x: 20, z: 40 } } : n,
      );
      await probe.update({ ...doc, nodes: moved });
      const planes = paintPlanes(paintOrder(moved));
      const sunk = planes.find((p) => p.item.id === "sunk");
      expect(sunk).toBeDefined();
      if (sunk === undefined) return;
      const drawn = probe.cornersOf("sunk");
      cornersOf(sunk.item, sunk.z, view).forEach((corner, i) => {
        const model = projectPoint(view, size, corner);
        expect(drawn?.[i]?.x).toBeCloseTo(model?.x ?? Number.NaN, 1);
        expect(drawn?.[i]?.y).toBeCloseTo(model?.y ?? Number.NaN, 1);
      });
      probe.dispose();
    });
  });
});
