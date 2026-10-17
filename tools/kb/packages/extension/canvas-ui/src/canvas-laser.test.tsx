/**
 * Present mode's laser: the pointer's trail fades as it ages and is gone a
 * trail's age after the pointer stops; it is drawn over the stage while
 * frames are presented and writes nothing.
 */
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { LASER_TRAIL_MS, laserSegments, liveLaserPoints } from "./canvas-laser";
import { CanvasLaserLayer } from "./canvas-laser-layer";

describe("the laser's trail", () => {
  const points = [
    { x: 0, y: 0, t: 0 },
    { x: 10, y: 0, t: 100 },
    { x: 20, y: 5, t: 300 },
  ];

  test("keeps the points younger than its age", () => {
    expect(liveLaserPoints(points, 650)).toEqual(points.slice(1));
    expect(liveLaserPoints(points, 300 + LASER_TRAIL_MS)).toEqual([]);
  });

  test("strokes each two points, the newer the stroke the more it shows", () => {
    const segments = laserSegments(points, 300);
    expect(segments.map((s) => [s.from.t, s.to.t])).toEqual([
      [0, 100],
      [100, 300],
    ]);
    expect(segments[1]?.opacity).toBe(1);
    expect(segments[0]?.opacity).toBeCloseTo(1 - 200 / LASER_TRAIL_MS);
  });

  test("is nothing for one point or none", () => {
    expect(laserSegments(points.slice(0, 1), 0)).toEqual([]);
    expect(laserSegments([], 0)).toEqual([]);
  });
});

describe("the laser layer", () => {
  let dom: InstalledDom;
  let root: Root;
  let stage: HTMLDivElement;

  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => dom.restore());
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  function Stage() {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div
        ref={(el) => {
          ref.current = el;
          if (el !== null) stage = el;
        }}
      >
        <CanvasLaserLayer stage={ref} on />
      </div>
    );
  }

  const move = (x: number, y: number) =>
    act(() => {
      stage.dispatchEvent(
        new window.MouseEvent("pointermove", {
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      );
    });

  test("draws the pointer's trail as it moves, and lets it fade away", () => {
    act(() => root.render(<Stage />));
    expect(document.querySelector('[data-testid="canvas-laser"]')).toBeNull();
    move(10, 10);
    move(40, 20);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(document.querySelectorAll('[data-testid="canvas-laser"] line')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(LASER_TRAIL_MS + 50);
    });
    expect(document.querySelector('[data-testid="canvas-laser"]')).toBeNull();
  });
});
