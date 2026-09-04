import type Sigma from "sigma";
import type { KbForceGraph } from "./force3d-instance";
import { fitView, focusNode, resetCamera, zoomIn, zoomOut } from "./graph-camera";

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
    focusNode: () => {
      /* tree has no focus verb */
    },
  };
}

export function force3dCameraControls(getGraph: () => KbForceGraph | null): GraphCameraControls {
  return {
    fit: () => {
      try {
        getGraph()?.zoomToFit(600, 40);
      } catch {
        /* torn down */
      }
    },
    zoomIn: () => {
      const g = getGraph();
      if (!g) return;
      try {
        const cam = g.cameraPosition();
        g.cameraPosition({ x: cam.x * 0.7, y: cam.y * 0.7, z: cam.z * 0.7 }, undefined, 400);
      } catch {
        /* */
      }
    },
    zoomOut: () => {
      const g = getGraph();
      if (!g) return;
      try {
        const cam = g.cameraPosition();
        g.cameraPosition({ x: cam.x * 1.4, y: cam.y * 1.4, z: cam.z * 1.4 }, undefined, 400);
      } catch {
        /* */
      }
    },
    reset: () => {
      try {
        getGraph()?.zoomToFit(600, 40);
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
        const dist = Math.hypot(node.x, node.y, node.z) || 1;
        const offset = 120;
        const lookAt = { x: node.x, y: node.y, z: node.z };
        g.cameraPosition(
          {
            x: node.x + (node.x / dist) * offset,
            y: node.y + (node.y / dist) * offset,
            z: node.z + (node.z / dist) * offset,
          },
          lookAt,
          1200,
        );
      } catch {
        /* */
      }
    },
  };
}
