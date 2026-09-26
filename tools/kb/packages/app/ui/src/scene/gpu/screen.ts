/**
 * Where a world point lands on a scene's canvas — the one projection every
 * real-time 3D view asks: the graph's labels, picking and render inspector,
 * and the Sky's hover.
 *
 * "In view" is decided in camera space, between the near and the far plane,
 * never from the projected z: three's WebGPU renderer switches the camera to
 * `WebGPUCoordinateSystem`, where the projected depth range differs from
 * WebGL's, and a point between the eye and the near plane can project to a
 * depth that looks valid under either. The view-space test holds for both.
 */
import { Vector3, type PerspectiveCamera } from "three/webgpu";

export interface ScreenPoint {
  /** Canvas-relative CSS pixels. */
  x: number;
  y: number;
  /** Distance from the eye along the view direction, world units. */
  depth: number;
}

const scratch = new Vector3();

/**
 * Project `world` (not mutated) for a canvas of `width` × `height` CSS
 * pixels into `out`. Returns whether the point is in view: in front of the
 * near plane, before the far plane, and on finite coordinates.
 */
export function toScreen(
  world: { readonly x: number; readonly y: number; readonly z: number },
  camera: PerspectiveCamera,
  size: { readonly width: number; readonly height: number },
  out: ScreenPoint,
): boolean {
  scratch.set(world.x, world.y, world.z).applyMatrix4(camera.matrixWorldInverse);
  const depth = -scratch.z;
  out.depth = depth;
  if (!(depth > camera.near && depth < camera.far)) return false;
  scratch.set(world.x, world.y, world.z).project(camera);
  out.x = ((scratch.x + 1) / 2) * size.width;
  out.y = ((1 - scratch.y) / 2) * size.height;
  return Number.isFinite(out.x) && Number.isFinite(out.y);
}

/** CSS pixels one world unit covers at `depth`, on a canvas `height` CSS pixels tall. */
export function pixelsPerUnit(camera: PerspectiveCamera, height: number, depth: number): number {
  return height / 2 / Math.tan((camera.fov * Math.PI) / 360) / depth;
}
