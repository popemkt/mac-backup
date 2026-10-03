import { describe, expect, test, vi } from "vitest";
import { CanvasCameraRig } from "@/lib/canvas-camera-rig";
import type { CanvasView } from "@/lib/canvas-camera";
import { TIMING_FALLBACK } from "@/lib/timing";

const flat: CanvasView = { x: 100, y: 50, z: 0, zoom: 1, yaw: 0, pitch: 0, fov: 0 };
const deep: CanvasView = { ...flat, yaw: -0.3, pitch: 0.6, fov: 34, zoom: 0.9 };
const size = { width: 800, height: 600 };

function run(rig: CanvasCameraRig, seconds: number) {
  let moving = true;
  for (let t = 0; t < seconds && moving; t += 1 / 60) moving = rig.step(1 / 60);
  return moving;
}

describe("the canvas camera rig", () => {
  test("a flight eases from where it starts to its goal, then arrives once", () => {
    const rig = new CanvasCameraRig(flat, TIMING_FALLBACK, false);
    const arrive = vi.fn();
    rig.flyTo(deep, arrive);
    rig.step(TIMING_FALLBACK.arrive / 2);
    // Half the time is most of the way on the settle ease, and the dolly is under way.
    expect(rig.view.fov).toBeGreaterThan(17);
    expect(rig.view.fov).toBeLessThan(34);
    expect(arrive).not.toHaveBeenCalled();
    expect(run(rig, 2)).toBe(false);
    expect(rig.view).toEqual(deep);
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  test("a delayed flight holds still first", () => {
    const rig = new CanvasCameraRig(flat, TIMING_FALLBACK, false);
    rig.flyTo(deep, undefined, 0.2);
    rig.step(0.19);
    expect(rig.view).toEqual(flat);
    expect(rig.flying).toBe(true);
  });

  test("under reduced motion a flight lands at once", () => {
    const rig = new CanvasCameraRig(flat, TIMING_FALLBACK, true);
    const arrive = vi.fn();
    rig.flyTo(deep, arrive);
    expect(rig.view).toEqual(deep);
    expect(rig.flying).toBe(false);
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  test("turning reduced motion on lands the flight under way", () => {
    const rig = new CanvasCameraRig(flat, TIMING_FALLBACK, false);
    const arrive = vi.fn();
    rig.flyTo(deep, arrive);
    rig.setReducedMotion(true);
    expect(rig.view).toEqual(deep);
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  test("a hand on the camera drops the flight, and its arrival with it", () => {
    const rig = new CanvasCameraRig(flat, TIMING_FALLBACK, false);
    const arrive = vi.fn();
    rig.flyTo(deep, arrive);
    rig.orbitBy(10, 0);
    run(rig, 2);
    expect(arrive).not.toHaveBeenCalled();
    expect(rig.flying).toBe(false);
  });

  test("every change wakes whoever draws", () => {
    const rig = new CanvasCameraRig(deep, TIMING_FALLBACK, false);
    const wake = vi.fn();
    rig.wake = wake;
    rig.panBy(4, 4);
    rig.zoomAt(1.2, { x: 10, y: 10 }, size);
    rig.flyTo(flat);
    expect(wake).toHaveBeenCalledTimes(3);
  });

  test("the keymap's controls zoom about the middle and fly to frame", () => {
    const rig = new CanvasCameraRig(deep, TIMING_FALLBACK, true);
    const settled = vi.fn();
    const items = [{ id: "a", x: 0, y: 0, width: 400, height: 300 }];
    const controls = rig.controls(() => size, settled);
    controls.zoomTo(2);
    expect(rig.view.zoom).toBeCloseTo(2, 9);
    controls.zoomBy(0.5);
    expect(rig.view.zoom).toBeCloseTo(1, 9);
    controls.frame(items);
    expect(rig.view.x).toBe(200);
    expect(rig.view.yaw).toBe(deep.yaw);
    expect(settled).toHaveBeenCalledTimes(3);
  });
});
