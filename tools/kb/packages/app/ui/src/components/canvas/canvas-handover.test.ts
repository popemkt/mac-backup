import { afterEach, describe, expect, test, vi } from "vitest";
import { viewOfPan } from "./canvas-camera";
import { CanvasCameraRig } from "./canvas-camera-rig";
import { TIMING_FALLBACK } from "@kb/ui-sdk";
import { CanvasHandover, type HandoverCanvas } from "./canvas-handover";

const size = { width: 1000, height: 600 };
const pan = { x: 40, y: 30 };
const pose = { x: 300, y: 200, z: 0, zoom: 0.8, yaw: -0.3, pitch: 0.5 };

function setup() {
  const rig = new CanvasCameraRig(viewOfPan(pan, 1, size), TIMING_FALLBACK, false);
  const canvas = {
    flat: () => ({ pan, zoom: 1 }),
    size: () => size,
    pose: () => pose,
    face: vi.fn<HandoverCanvas["face"]>(),
    arrived: vi.fn<HandoverCanvas["arrived"]>(),
  };
  const handover = new CanvasHandover(rig, TIMING_FALLBACK, canvas);
  const land = () => {
    for (let i = 0; i < 200 && rig.step(1 / 30); i++);
  };
  return { rig, canvas, handover, land };
}

afterEach(() => vi.useRealTimers());

describe("the projection handover", () => {
  test("into 3D: stand where 2D is, mount, crossfade, then fly to the saved pose", () => {
    const { rig, canvas, handover, land } = setup();
    handover.want("3d");
    expect(handover.snapshot()).toMatchObject({ shown: "2d", phase: "entering", entry: 1 });
    expect(rig.view).toEqual(viewOfPan(pan, 1, size));
    handover.ready("3d");
    expect(handover.snapshot()).toMatchObject({ shown: "3d", phase: null });
    // The dolly waits out the crossfade: face-on for its duration.
    rig.step(TIMING_FALLBACK.reveal * 0.9);
    expect(rig.view.fov).toBe(0);
    land();
    expect(rig.view).toMatchObject({ ...pose, fov: 34 });
    expect(canvas.arrived).toHaveBeenCalledWith(pose.zoom);
  });

  test("back to 2D: fly face-on, hand the pan and zoom over, then let the scene fade", () => {
    vi.useFakeTimers();
    const { canvas, handover, land } = setup();
    handover.want("3d");
    handover.ready("3d");
    land();
    handover.want("2d");
    expect(handover.snapshot().phase).toBe("leaving");
    land();
    expect(handover.snapshot()).toMatchObject({ shown: "2d", phase: "lingering" });
    const [facePan, faceZoom] = canvas.face.mock.calls[0] ?? [];
    expect(faceZoom).toBeCloseTo(pose.zoom, 9);
    expect(facePan?.x).toBeCloseTo(size.width / 2 - pose.x * pose.zoom, 6);
    vi.runAllTimers();
    expect(handover.snapshot().phase).toBeNull();
  });

  test("turning back halfway flies the other way, and never lands in 2D", () => {
    const { canvas, handover, land, rig } = setup();
    handover.want("3d");
    handover.ready("3d");
    land();
    handover.want("2d");
    rig.step(0.1);
    handover.want("3d");
    land();
    expect(canvas.face).not.toHaveBeenCalled();
    expect(handover.snapshot()).toMatchObject({ shown: "3d", phase: null });
  });

  test("a scene that cannot start leaves the canvas in 2D until asked again", () => {
    const { handover } = setup();
    handover.want("3d");
    handover.fail();
    handover.want("3d");
    expect(handover.snapshot()).toMatchObject({ shown: "2d", phase: null, failed: true });
    handover.retry();
    handover.want("3d");
    expect(handover.snapshot()).toMatchObject({ phase: "entering", entry: 2 });
  });

  test("changing its mind before the scene draws mounts nothing", () => {
    const { handover } = setup();
    handover.want("3d");
    handover.want("2d");
    handover.ready("3d");
    expect(handover.snapshot()).toMatchObject({ shown: "2d", phase: null });
  });
});
