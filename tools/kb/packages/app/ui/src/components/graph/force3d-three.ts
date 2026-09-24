import { PerspectiveCamera, type Camera } from "three";

export { CanvasTexture, Object3D, Sprite, SpriteMaterial } from "three";

/** three's own `PerspectiveCamera` default, for a camera that has no field of view. */
const DEFAULT_FOV = 50;

/**
 * The vertical field of view a label is sized against. 3d-force-graph hands
 * out its camera as the base `Camera`, which has no `fov`; the one it builds
 * is a `PerspectiveCamera`, and this is where that is checked rather than
 * assumed.
 */
export function cameraFov(camera: Camera): number {
  return camera instanceof PerspectiveCamera ? camera.fov : DEFAULT_FOV;
}
