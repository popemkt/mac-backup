/**
 * The 3D graph's side of a node drag (`lib/graph-drag`): the surface. A
 * press suspends the orbit; once it is a drag the camera is held still
 * (`GraphCamera.hold`: no fit follows the layout, no flight moves the eye)
 * and the node follows the pointer's ray on the plane through where it was
 * grabbed, facing the eye — so it moves across the screen, never toward or
 * away from the viewer — keeping the offset it was pressed at. The layout's
 * side is `GraphLayers.dragLayout`.
 */
import { Vector3, type PerspectiveCamera } from "three/webgpu";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { DragSurface } from "@/lib/graph-drag";
import { onFacingPlane } from "@/scene/gpu/screen";
import type { GraphCamera, GraphPlaces } from "./force3d-camera";

export function sceneDragSurface(rig: {
  readonly canvas: HTMLCanvasElement;
  readonly camera: PerspectiveCamera;
  readonly orbit: OrbitControls;
  readonly view: GraphCamera;
  readonly places: GraphPlaces;
}): DragSurface {
  const { canvas, camera, orbit, view, places } = rig;
  const hit = new Vector3();
  /** Where canvas point (x, y) meets the plane through `through` facing the eye. */
  const onPlane = (x: number, y: number, through: Vector3): boolean => {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    return onFacingPlane(camera, (x / width) * 2 - 1, 1 - (y / height) * 2, through, hit);
  };
  return {
    suspend: () => {
      orbit.enabled = false;
    },
    resume: () => {
      orbit.enabled = true;
    },
    grip: (id, x, y) => {
      const i = places.indexOf(id);
      if (i < 0) return null;
      view.hold();
      const positions = places.positions();
      const node = new Vector3(
        positions[i * 3] ?? 0,
        positions[i * 3 + 1] ?? 0,
        positions[i * 3 + 2] ?? 0,
      );
      if (!onPlane(x, y, node)) return null;
      const offset = node.clone().sub(hit);
      return (px, py) => {
        if (!onPlane(px, py, node)) return null;
        return { x: hit.x + offset.x, y: hit.y + offset.y, z: hit.z + offset.z };
      };
    },
  };
}
