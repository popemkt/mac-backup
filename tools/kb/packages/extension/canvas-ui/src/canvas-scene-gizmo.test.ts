/**
 * The gizmo bridge, on real `TransformControls` and the camera model: a drag
 * on a handle comes back as the canvas-space transform the person saw — the
 * y flip between canvas space and three's world undone, the turn clockwise
 * from the top positive, as the document reads it.
 */
import { describe, expect, test } from "vitest";
import { PerspectiveCamera, Scene, Vector3 } from "three/webgpu";
import { rotationOfMatrix, type CanvasNode } from "@kb/canvas";
import { cameraPose, type CanvasView } from "./canvas-camera";
import { GizmoLayer } from "./canvas-scene-gizmo";
import type { GizmoChoice } from "./canvas-gizmo";

const size = { width: 800, height: 600 };
/** Straight down, through the orthographic lens: the 2D view's look, so screen pixels are units. */
const top: CanvasView = { x: 0, y: 0, z: 0, zoom: 1, yaw: 0, pitch: 0, fov: 0 };
const crate: CanvasNode = {
  id: "c",
  type: "shape",
  shape: "rect",
  x: -50,
  y: -40,
  width: 100,
  height: 80,
  depth: 60,
};

/** A gizmo on `crate`, its stage camera aimed as the scene aims it for `top`. */
function gizmoOn(choice: GizmoChoice) {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const pose = cameraPose(top, size);
  camera.position.set(pose.eye.x, -pose.eye.y, pose.eye.z);
  camera.up.set(pose.up.x, -pose.up.y, pose.up.z);
  camera.lookAt(new Vector3(0, 0, 0));
  camera.updateMatrixWorld();
  const layer = new GizmoLayer(scene, camera);
  layer.follow(top, size, true);
  layer.setTarget([crate], choice);
  scene.updateMatrixWorld(true);
  return layer;
}

/** A screen point `r` pixels from the pivot (the stage's centre) at `degrees` clockwise from +x. */
const around = (r: number, degrees: number) => ({
  x: size.width / 2 + r * Math.cos((degrees * Math.PI) / 180),
  y: size.height / 2 + r * Math.sin((degrees * Math.PI) / 180),
});

describe("the gizmo bridge", () => {
  test("dragging the move arrow right moves the selection right, and up the page moves it -y", () => {
    const right = gizmoOn({ mode: "move", space: "global" });
    expect(right.press(top, size, around(60, 0))).toBe(true);
    const across = right.drag(top, size, around(110, 0));
    right.release();
    expect(across?.move.x).toBeCloseTo(50, 1);
    expect(across?.move.y).toBeCloseTo(0, 1);
    // The pivot is the crate's centre, halfway up it.
    expect(across?.pivot).toEqual({ x: 0, y: 0, z: 30 });

    const upward = gizmoOn({ mode: "move", space: "global" });
    // Up the screen is up the page: canvas -y, which is three's +y.
    expect(upward.press(top, size, around(60, 270))).toBe(true);
    const along = upward.drag(top, size, around(100, 270));
    upward.release();
    expect(along?.move.y).toBeCloseTo(-40, 1);
    expect(along?.move.x).toBeCloseTo(0, 1);
  });

  test("turning the ring clockwise on screen turns the selection +z, clockwise from the top", () => {
    const ring = gizmoOn({ mode: "rotate", space: "global" });
    // The ring about z faces the eye from the top: 75 px out (half the handles' 150 px span).
    expect(ring.press(top, size, around(75, 45))).toBe(true);
    const turned = ring.drag(top, size, around(75, 75));
    ring.release();
    expect(turned).not.toBeNull();
    if (turned === null) return;
    const angles = rotationOfMatrix(turned.turn);
    expect(angles.z).toBeCloseTo(30, 0);
    expect(Math.abs(angles.x) + Math.abs(angles.y)).toBeLessThan(0.5);
  });

  test("nothing selected, nothing to take hold of", () => {
    const layer = gizmoOn({ mode: "move", space: "global" });
    layer.setTarget([], { mode: "move", space: "global" });
    expect(layer.press(top, size, around(60, 0))).toBe(false);
  });
});
