import { describe, expect, test } from "vitest";
import {
  MAX_PITCH,
  PERSPECTIVE_FOV,
  heldOrbit,
  lensOf,
  presetOf,
  presetView,
  screenAxes,
  withLens,
  cameraPose,
  clientToCanvas,
  fitView,
  hitTest,
  lerpView,
  orbitView,
  paintPlanes,
  panOfView,
  panView,
  poseOfView,
  projectPoint,
  screenToPlane,
  viewOfPan,
  viewOfPose,
  zoomViewAt,
  type CanvasHitItem,
  type CanvasView,
} from "@/lib/canvas-camera";

const size = { width: 1200, height: 800 };
const perspective: CanvasView = {
  x: 300,
  y: 200,
  z: 0,
  zoom: 1.3,
  yaw: 0.4,
  pitch: 0.5,
  fov: 40,
};

describe("the 2D view is a CSS translate and scale", () => {
  const pan = { x: 37, y: -120 };
  const zoom = 0.8;
  const view = viewOfPan(pan, zoom, size);

  test("a canvas point lands where the transform draws it", () => {
    const at = projectPoint(view, size, { x: 410, y: 95, z: 0 });
    expect(at?.x).toBeCloseTo(410 * zoom + pan.x, 9);
    expect(at?.y).toBeCloseTo(95 * zoom + pan.y, 9);
  });

  test("depth never moves a point face-on and orthographic", () => {
    const flat = projectPoint(view, size, { x: 410, y: 95, z: 0 });
    const raised = projectPoint(view, size, { x: 410, y: 95, z: 300 });
    expect(raised?.x).toBeCloseTo(flat?.x ?? Number.NaN, 9);
    expect(raised?.y).toBeCloseTo(flat?.y ?? Number.NaN, 9);
  });

  test("the pan and zoom come back out of the view", () => {
    const back = panOfView(view, size);
    expect(back.zoom).toBe(zoom);
    expect(back.pan.x).toBeCloseTo(pan.x, 9);
    expect(back.pan.y).toBeCloseTo(pan.y, 9);
  });

  test("client coordinates enter through the viewport's corner", () => {
    const viewport = { left: 64, top: 40, ...size };
    const at = clientToCanvas({ x: 500, y: 300 }, viewport, pan, zoom);
    expect(at.x).toBeCloseTo((500 - 64 - pan.x) / zoom, 9);
    expect(at.y).toBeCloseTo((300 - 40 - pan.y) / zoom, 9);
  });
});

describe("perspective", () => {
  test("the focus plane keeps the view's zoom at the focus", () => {
    const view = { ...perspective, yaw: 0, pitch: 0 };
    const focus = projectPoint(view, size, { x: view.x, y: view.y, z: 0 });
    const step = projectPoint(view, size, { x: view.x + 10, y: view.y, z: 0 });
    expect(focus?.x).toBeCloseTo(size.width / 2, 9);
    expect((step?.x ?? 0) - (focus?.x ?? 0)).toBeCloseTo(10 * view.zoom, 9);
  });

  test("a nearer point covers more of the screen", () => {
    const view = { ...perspective, yaw: 0, pitch: 0 };
    const spread = (z: number) =>
      (projectPoint(view, size, { x: view.x + 10, y: view.y, z })?.x ?? 0) -
      (projectPoint(view, size, { x: view.x, y: view.y, z })?.x ?? 0);
    expect(spread(200)).toBeGreaterThan(spread(0));
    expect(spread(-200)).toBeLessThan(spread(0));
  });

  test.each([0, 120, -80])("a point on the plane at z=%d unprojects back to itself", (z) => {
    const point = { x: 520, y: 140, z };
    const screen = projectPoint(perspective, size, point);
    expect(screen).not.toBeNull();
    const back = screenToPlane(perspective, size, screen ?? { x: 0, y: 0 }, z);
    expect(back?.x).toBeCloseTo(point.x, 6);
    expect(back?.y).toBeCloseTo(point.y, 6);
  });

  test("a point behind the eye does not project", () => {
    const view = { ...perspective, yaw: 0, pitch: 0 };
    expect(projectPoint(view, size, { x: view.x, y: view.y, z: 1e7 })).toBeNull();
  });
});

describe("hit-testing", () => {
  const low: CanvasHitItem = { id: "low", x: 0, y: 0, width: 200, height: 100 };
  const high: CanvasHitItem = { id: "high", x: 100, y: 0, width: 200, height: 100, z: 150 };
  const later: CanvasHitItem = { id: "later", x: 150, y: 20, width: 40, height: 40 };

  test("face-on, the item painted last wins at one depth", () => {
    const view = viewOfPan({ x: 0, y: 0 }, 1, size);
    expect(hitTest([low, later], view, size, { x: 160, y: 30 })).toBe("later");
    expect(hitTest([later, low], view, size, { x: 160, y: 30 })).toBe("low");
  });

  test("the nearer item wins whatever the paint order", () => {
    const view = viewOfPan({ x: 0, y: 0 }, 1, size);
    expect(hitTest([high, low, later], view, size, { x: 160, y: 30 })).toBe("high");
  });

  test("seen from under the floor, the nearer item is the deeper one", () => {
    // No orbit reaches under the floor, but the model answers for any eye.
    const behind = { ...perspective, x: 150, y: 50, yaw: 0, pitch: Math.PI };
    const at = projectPoint(behind, size, { x: 160, y: 30, z: 0 });
    expect(hitTest([low, high], behind, size, at ?? { x: 0, y: 0 })).toBe("low");
  });

  test("a box is hit on its side as well as its top, nearest first", () => {
    // Level from the front (the eye on the +y side), a raised box hides a flat card behind it.
    const front = { ...perspective, x: 100, y: 0, z: 60, yaw: 0, pitch: Math.PI / 2 };
    const block: CanvasHitItem = { id: "block", x: 50, y: 100, width: 100, height: 40, depth: 120 };
    const behind: CanvasHitItem = { id: "behind", x: 0, y: -400, width: 200, height: 10 };
    const at = projectPoint(front, size, { x: 100, y: 140, z: 60 }) ?? { x: 0, y: 0 };
    expect(hitTest([behind, block], front, size, at)).toBe("block");
    expect(hitTest([{ ...block, depth: 0 }], front, size, at)).toBeNull();
  });

  test("paint order breaks ties between equal tops, not equal bases", () => {
    const block: CanvasHitItem = { id: "block", x: 0, y: 0, width: 10, height: 10, depth: 40 };
    const lid: CanvasHitItem = { id: "lid", x: 0, y: 0, width: 10, height: 10, z: 40 };
    const [, raised] = paintPlanes([block, lid]);
    expect(raised?.z).toBeGreaterThan(40);
    const [, apart] = paintPlanes([block, { ...lid, z: 41 }]);
    expect(apart?.z).toBe(41);
  });

  test("an empty point hits nothing", () => {
    expect(hitTest([low], perspective, size, { x: 2, y: 2 })).toBeNull();
  });
});

describe("zoom to fit", () => {
  test("frames every item, keeping the orbit", () => {
    const items: CanvasHitItem[] = [
      { id: "a", x: -400, y: 0, width: 200, height: 100 },
      { id: "b", x: 900, y: 600, width: 200, height: 100, z: 80 },
    ];
    const fitted = fitView(items, size, perspective);
    expect(fitted).not.toBeNull();
    if (fitted === null) return;
    expect(fitted.yaw).toBe(perspective.yaw);
    expect(fitted.x).toBe(350);
    expect(fitted.z).toBe(40);
    const face = viewOfPan({ x: 0, y: 0 }, 1, size);
    const flat = fitView(items, size, face);
    for (const corner of [
      { x: -400, y: 0 },
      { x: 1100, y: 700 },
    ]) {
      const at = projectPoint(flat ?? face, size, { ...corner, z: 0 });
      expect(at?.x).toBeGreaterThanOrEqual(39.999);
      expect(at?.x).toBeLessThanOrEqual(size.width - 39.999);
    }
  });

  test("nothing to frame is no view", () => {
    expect(fitView([], size, perspective)).toBeNull();
  });
});

describe("moving the camera", () => {
  test("a pan carries the focus plane with the pointer", () => {
    const panned = panView(perspective, 30, -12);
    const focus = { x: perspective.x, y: perspective.y, z: perspective.z };
    const f0 = projectPoint(perspective, size, focus);
    const f1 = projectPoint(panned, size, focus);
    expect((f1?.x ?? 0) - (f0?.x ?? 0)).toBeCloseTo(30, 6);
    expect((f1?.y ?? 0) - (f0?.y ?? 0)).toBeCloseTo(-12, 6);
  });

  test("zooming about a point keeps the canvas under it", () => {
    const cursor = { x: 900, y: 200 };
    const under = screenToPlane(perspective, size, cursor, perspective.z);
    const zoomed = zoomViewAt(perspective, size, 1.6, cursor);
    expect(zoomed.zoom).toBeCloseTo(perspective.zoom * 1.6, 9);
    const after = projectPoint(zoomed, size, under ?? { x: 0, y: 0, z: 0 });
    expect(after?.x).toBeCloseTo(cursor.x, 3);
    expect(after?.y).toBeCloseTo(cursor.y, 3);
  });

  test("an orbit is a turntable: from the top down to level, never under the floor", () => {
    expect(orbitView(perspective, 0, -10_000).pitch).toBe(MAX_PITCH);
    expect(MAX_PITCH).toBe(Math.PI / 2);
    expect(orbitView(perspective, 0, 10_000).pitch).toBe(0);
    expect(heldOrbit({ ...perspective, pitch: -0.4 }).pitch).toBe(0);
  });

  test("a drag across turns the floor with the hand: its near edge follows", () => {
    const near = { x: perspective.x, y: perspective.y + 200, z: 0 };
    const before = projectPoint(perspective, size, near);
    const after = projectPoint(orbitView(perspective, 40, 0), size, near);
    expect((after?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(0);
  });

  test("a drag down tips the view toward the top", () => {
    expect(orbitView(perspective, 0, 30).pitch).toBeLessThan(perspective.pitch);
  });

  test("a lerp turns the short way round and zooms in proportion", () => {
    const a = { ...perspective, yaw: 3, zoom: 1 };
    const b = { ...perspective, yaw: -3, zoom: 4 };
    const mid = lerpView(a, b, 0.5);
    expect(Math.abs(mid.yaw)).toBeGreaterThan(3);
    expect(mid.zoom).toBeCloseTo(2, 9);
    expect(lerpView(a, b, 1).fov).toBe(b.fov);
  });

  test("the pose a renderer aims with has up square to the line of sight", () => {
    const pose = cameraPose(perspective, size);
    const sight = {
      x: pose.target.x - pose.eye.x,
      y: pose.target.y - pose.eye.y,
      z: pose.target.z - pose.eye.z,
    };
    expect(sight.x * pose.up.x + sight.y * pose.up.y + sight.z * pose.up.z).toBeCloseTo(0, 6);
  });

  test("a pose saves the whole view, lens and all, and comes back whole", () => {
    expect(viewOfPose(poseOfView(perspective), 0)).toEqual(perspective);
    const { fov: _lens, ...older } = poseOfView(perspective);
    expect(viewOfPose(older, PERSPECTIVE_FOV).fov).toBe(PERSPECTIVE_FOV);
  });
});

describe("the floor", () => {
  const at = (view: CanvasView, p: { x: number; y: number; z: number }) =>
    projectPoint(view, size, p) ?? { x: Number.NaN, y: Number.NaN, depth: Number.NaN };
  const focus = { x: perspective.x, y: perspective.y, z: 0 };

  test("from the top, x is right, y is down and z points at the eye", () => {
    const axes = screenAxes(presetView(perspective, "top"));
    expect(axes.x.x).toBeCloseTo(1, 9);
    expect(axes.x.y).toBeCloseTo(0, 9);
    expect(axes.y.y).toBeCloseTo(1, 9);
    expect(axes.z.toward).toBeCloseTo(1, 9);
  });

  test("from the front, z is up the screen and the eye stands on the +y side", () => {
    const front = presetView({ ...perspective, fov: 0 }, "front");
    const up = at(front, { ...focus, z: 100 });
    expect(up.y).toBeLessThan(size.height / 2 - 50);
    expect(at(front, { ...focus, x: focus.x + 100 }).x).toBeGreaterThan(size.width / 2);
    expect(screenAxes(front).y.toward).toBeCloseTo(1, 9);
  });

  test.each([
    ["right", "x", 1],
    ["left", "x", -1],
    ["front", "y", 1],
    ["back", "y", -1],
  ] as const)("the %s view's eye stands on the %s axis's %d side", (preset, axis, side) => {
    expect(screenAxes(presetView(perspective, preset))[axis].toward).toBeCloseTo(side, 9);
  });

  test("a preset is recognised, and any other orbit is not", () => {
    expect(presetOf(presetView(perspective, "right"))).toBe("right");
    expect(presetOf({ ...presetView(perspective, "back"), yaw: -Math.PI })).toBe("back");
    expect(presetOf(perspective)).toBeNull();
  });

  test("a lens swap keeps the focus plane's zoom", () => {
    const top = presetView(perspective, "top");
    const ortho = withLens(top, "orthographic");
    expect(lensOf(ortho)).toBe("orthographic");
    expect(lensOf(withLens(ortho, "perspective"))).toBe("perspective");
    const step = (view: CanvasView) =>
      at(view, { ...focus, x: focus.x + 10 }).x - at(view, focus).x;
    expect(step(ortho)).toBeCloseTo(step(top), 6);
  });

  test("a frame from the front measures width and height above the floor", () => {
    const items: CanvasHitItem[] = [
      { id: "low", x: 0, y: 0, width: 400, height: 2000 },
      { id: "high", x: 0, y: 0, width: 400, height: 100, z: 300 },
    ];
    const front = presetView({ ...perspective, fov: 0 }, "front");
    const framed = fitView(items, size, front);
    // 400 wide by 300 high on screen: the 2000 deep footprint is edge-on.
    expect(framed?.zoom).toBeCloseTo(1, 9);
    expect(framed?.z).toBe(150);
  });
});
