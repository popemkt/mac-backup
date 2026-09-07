import type Sigma from "sigma";
import type { KbForceGraph } from "./force3d-instance";
import { fitView, focusNode, resetCamera, zoomIn, zoomOut, motionDuration } from "./graph-camera";

/**
 * Renderer-agnostic camera verbs the shared toolbar/keyboard drive.
 * Replaces the frame's former `sigmaRef: MutableRefObject<Sigma | null>`.
 */
export interface GraphCameraControls {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  focusNode: (id: string) => void;
  expandAll?: () => void;
  collapseAll?: () => void;
  /** Label lookup for search Enter → focus (optional). */
  labelOf?: (id: string) => string | undefined;
}

export function sigmaCameraControls(getSigma: () => Sigma | null): GraphCameraControls {
  return {
    fit: () => {
      const s = getSigma();
      if (s) fitView(s);
    },
    zoomIn: () => {
      const s = getSigma();
      if (s) zoomIn(s);
    },
    zoomOut: () => {
      const s = getSigma();
      if (s) zoomOut(s);
    },
    reset: () => {
      const s = getSigma();
      if (s) resetCamera(s);
    },
    focusNode: (id) => {
      const s = getSigma();
      if (s) focusNode(s, id);
    },
    labelOf: (id) => {
      const s = getSigma();
      if (s?.getGraph().hasNode(id) !== true) return undefined;
      const label = s.getGraph().getNodeAttribute(id, "label");
      return typeof label === "string" ? label : undefined;
    },
  };
}

export interface TreeViewHandle {
  focusNode: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

export function treeCameraControls(getHandle: () => TreeViewHandle | null): GraphCameraControls {
  return {
    fit: () => getHandle()?.fit(),
    zoomIn: () => getHandle()?.zoomIn(),
    zoomOut: () => getHandle()?.zoomOut(),
    reset: () => getHandle()?.reset(),
    focusNode: (id) => getHandle()?.focusNode(id),
    expandAll: () => getHandle()?.expandAll(),
    collapseAll: () => getHandle()?.collapseAll(),
  };
}

export function force3dCameraControls(getGraph: () => KbForceGraph | null): GraphCameraControls {
  return {
    fit: () => {
      try {
        getGraph()?.zoomToFit(motionDuration(600), 40);
      } catch {
        /* torn down */
      }
    },
    zoomIn: () => {
      const g = getGraph();
      if (!g) return;
      try {
        const cam = g.cameraPosition();
        const target = orbitTarget(g);
        g.cameraPosition(scaleFromTarget(cam, target, 0.7), target, motionDuration(400));
      } catch {
        /* */
      }
    },
    zoomOut: () => {
      const g = getGraph();
      if (!g) return;
      try {
        const cam = g.cameraPosition();
        const target = orbitTarget(g);
        g.cameraPosition(scaleFromTarget(cam, target, 1.4), target, motionDuration(400));
      } catch {
        /* */
      }
    },
    reset: () => {
      try {
        getGraph()?.zoomToFit(motionDuration(600), 40);
      } catch {
        /* */
      }
    },
    focusNode: (id) => {
      const g = getGraph();
      if (!g) return;
      try {
        const node = g.graphData().nodes.find((n) => n.id === id);
        if (
          !node ||
          typeof node.x !== "number" ||
          typeof node.y !== "number" ||
          typeof node.z !== "number"
        ) {
          return;
        }
        const camera = g.cameraPosition();
        const target = orbitTarget(g);
        const dx = camera.x - target.x,
          dy = camera.y - target.y,
          dz = camera.z - target.z;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const offset = 120;
        const lookAt = { x: node.x, y: node.y, z: node.z };
        g.cameraPosition(
          {
            x: node.x + (dx / dist) * offset,
            y: node.y + (dy / dist) * offset,
            z: node.z + (dz / dist) * offset,
          },
          lookAt,
          motionDuration(500),
        );
      } catch {
        /* */
      }
    },
  };
}

export type CameraPoint = { x: number; y: number; z: number };
export function scaleFromTarget(
  camera: CameraPoint,
  target: CameraPoint,
  scale: number,
): CameraPoint {
  return {
    x: target.x + (camera.x - target.x) * scale,
    y: target.y + (camera.y - target.y) * scale,
    z: target.z + (camera.z - target.z) * scale,
  };
}
function orbitTarget(graph: KbForceGraph): CameraPoint {
  const controls = graph.controls();
  if ("target" in controls && typeof controls.target === "object" && controls.target !== null) {
    const target = controls.target;
    if (
      "x" in target &&
      typeof target.x === "number" &&
      "y" in target &&
      typeof target.y === "number" &&
      "z" in target &&
      typeof target.z === "number"
    )
      return { x: target.x, y: target.y, z: target.z };
  }
  return { x: 0, y: 0, z: 0 };
}
