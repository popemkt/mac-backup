import { describe, expect, test } from "vitest";
import {
  clientToCanvas,
  fitView,
  hitTest,
  panOfView,
  projectPoint,
  screenToPlane,
  viewOfPan,
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

  test("seen from behind, the nearer item is the deeper one", () => {
    const behind = { ...perspective, x: 150, y: 50, yaw: Math.PI, pitch: 0 };
    const at = projectPoint(behind, size, { x: 160, y: 30, z: 0 });
    expect(hitTest([low, high], behind, size, at ?? { x: 0, y: 0 })).toBe("low");
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
