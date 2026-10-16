import type Sigma from "sigma";
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
