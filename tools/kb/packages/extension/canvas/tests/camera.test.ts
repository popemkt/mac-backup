/**
 * A canvas's camera as its view node holds it (DESIGN.md → Canvas documents
 * → Camera): what the canvas view reads and writes, the view node a canvas
 * is looked at through, and a camera as documents held it before it moved.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Result } from "effect";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import { viewNodeFor } from "@kb/views";
import {
  CANVAS_IDS,
  CanvasView,
  cameraLookingFrom,
  canvasCameraProps,
  canvasViewIdOf,
  parseLegacyCamera,
  posesAgree,
  projectionOf,
  readCanvasCamera,
  type CanvasCamera,
} from "../src/index.ts";

const POSE = { x: 1, y: 2, z: 3, zoom: 1, yaw: 0.2, pitch: 0.4 };

const finite = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 });
const cameraArb: fc.Arbitrary<CanvasCamera> = fc.record(
  {
    projection: fc.constantFrom("2d" as const, "3d" as const),
    pose: fc.record(
      {
        x: finite,
        y: finite,
        z: finite,
        zoom: fc.double({ noNaN: true, min: 0.001, max: 100 }),
        yaw: finite,
        pitch: finite,
        fov: fc.double({ noNaN: true, min: 0, max: 179 }),
      },
      { requiredKeys: ["x", "y", "z", "zoom", "yaw", "pitch"] },
    ),
  },
  { requiredKeys: ["projection"] },
);

describe("a camera on a view node", () => {
  test("reads back as it was written", () => {
    fc.assert(
      fc.property(cameraArb, (camera) => {
        const read = readCanvasCamera(canvasCameraProps(camera));
        expect(read?.projection).toBe(camera.projection);
        expect(posesAgree(read?.pose, camera.pose)).toBe(true);
      }),
    );
  });

  test("no camera is 2D, and writes nothing", () => {
    expect(readCanvasCamera({})).toBeUndefined();
    expect(projectionOf(readCanvasCamera({}))).toBe("2d");
    expect(canvasCameraProps(undefined)).toEqual({});
  });

  test("the projection is one of its field's option nodes", () => {
    expect(canvasCameraProps({ projection: "3d" })).toEqual({
      [CANVAS_IDS.canvasProjectionField]: [{ t: "ref", v: CANVAS_IDS.canvasProjection3d }],
    });
  });

  test("a projection or a pose kb cannot read is reported, and the rest still reads", () => {
    const warnings: string[] = [];
    const report = (warning: string) => warnings.push(warning);
    expect(
      readCanvasCamera({ [CANVAS_IDS.canvasProjectionField]: [{ t: "ref", v: "n.vr" }] }, report),
    ).toBeUndefined();
    const unreadPose = {
      ...canvasCameraProps({ projection: "3d" }),
      [CANVAS_IDS.canvasPoseField]: [{ t: "str" as const, v: '{"x":1}' }],
    };
    expect(readCanvasCamera(unreadPose, report)).toEqual({ projection: "3d" });
    expect(warnings).toHaveLength(2);
  });

  test("a lens kb cannot read is no lens at all", () => {
    const props = {
      ...canvasCameraProps({ projection: "3d" }),
      [CANVAS_IDS.canvasPoseField]: [
        { t: "str" as const, v: JSON.stringify({ ...POSE, fov: -4 }) },
      ],
    };
    expect(readCanvasCamera(props)?.pose).toEqual(POSE);
  });
});

describe("the canvas view's settings", () => {
  test("a camera proposed for a canvas is what its view node reads back, shown for it", () => {
    const params = { id: "n.board", projection: "3d" as const, pose: { ...POSE, fov: 34 } };
    const proposed = viewNodeFor(CanvasView, params, "n.board");
    if (Result.isFailure(proposed)) throw new Error(JSON.stringify(proposed.failure));
    expect(proposed.success.params).toEqual(params);
    expect(proposed.success.props[SYSTEM_IDS.viewField]).toEqual([
      { t: "ref", v: CanvasView.option },
    ]);
    expect(CanvasView.config.read(proposed.success.props, "n.other", () => {})).toEqual({
      ...params,
      id: "n.other",
    });
  });

  test("a view node with no camera opens its canvas in 2D", () => {
    const proposed = viewNodeFor(CanvasView, { id: "n.board" }, "n.board");
    expect(Result.isSuccess(proposed)).toBe(true);
  });
});

const node = (id: string, props: KbNode["props"] = {}) => ({ id, props });
const viewOf = (option: string) => ({
  [SYSTEM_IDS.viewField]: [{ t: "ref" as const, v: option }],
});

describe("the view node a canvas is looked at through", () => {
  const nodes = new Map([
    ["v.outline", node("v.outline", viewOf("sys.view.outline"))],
    ["v.first", node("v.first", viewOf(CanvasView.option))],
    ["v.second", node("v.second", viewOf(CanvasView.option))],
  ]);
  const canvas = (views: string[]) =>
    node("n.board", { [SYSTEM_IDS.viewsField]: views.map((v) => ({ t: "ref" as const, v })) });

  test("is the first of its views that is a canvas view", () => {
    expect(
      canvasViewIdOf(canvas(["v.outline", "v.first", "v.second"]), (id) => nodes.get(id)),
    ).toBe("v.first");
  });

  test("is none when it names no canvas view", () => {
    expect(canvasViewIdOf(canvas(["v.outline"]), (id) => nodes.get(id))).toBeNull();
    expect(canvasViewIdOf(undefined, (id) => nodes.get(id))).toBeNull();
  });
});

describe("a camera as a document held it before it moved", () => {
  test("reads as the camera it was", () => {
    expect(parseLegacyCamera({ projection: "3d", pose: POSE })).toEqual({
      projection: "3d",
      pose: POSE,
    });
    expect(parseLegacyCamera({ projection: "2d", pose: 7 })).toEqual({ projection: "2d" });
  });

  test("is none when it names no projection kb knows", () => {
    expect(parseLegacyCamera({ projection: "vr" })).toBeUndefined();
    expect(parseLegacyCamera("3d")).toBeUndefined();
  });
});

describe("looking from a pose", () => {
  test("switching projection keeps the pose, and a given pose replaces it", () => {
    const camera: CanvasCamera = { projection: "3d", pose: POSE };
    expect(cameraLookingFrom(camera, "2d")).toEqual({ projection: "2d", pose: POSE });
    const other = { ...POSE, x: 9 };
    expect(cameraLookingFrom(camera, "3d", other)).toEqual({ projection: "3d", pose: other });
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
});
