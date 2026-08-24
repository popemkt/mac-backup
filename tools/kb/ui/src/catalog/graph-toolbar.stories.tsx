import { createElement, type ReactElement } from "react";
import { GraphToolbar } from "@/components/graph/graph-toolbar";
import { RENDERER_CAPABILITIES } from "@/components/graph/graph-capabilities";
import type { GraphCameraControls } from "@/components/graph/graph-camera-controls";

const noopControls: GraphCameraControls = {
  fit: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
  reset: () => {},
  focusNode: () => {},
};

/** Catalog: GraphToolbar — idle / with search open (via default idle chrome). */
export const stories = {
  idle: (): ReactElement =>
    createElement(GraphToolbar, {
      capabilities: RENDERER_CAPABILITIES.force2d!,
      controls: noopControls,
      selectedNodeId: null,
      nodes: [
        { id: "n.a", label: "Alpha" },
        { id: "n.b", label: "Beta" },
        { id: "n.c", label: "Gamma" },
      ],
    }),
  withSelection: (): ReactElement =>
    createElement(GraphToolbar, {
      capabilities: RENDERER_CAPABILITIES.force2d!,
      controls: noopControls,
      selectedNodeId: "n.a",
      nodes: [
        { id: "n.a", label: "Alpha" },
        { id: "n.b", label: "Beta" },
      ],
    }),
  treePartial: (): ReactElement =>
    createElement(GraphToolbar, {
      capabilities: RENDERER_CAPABILITIES.tree!,
      controls: noopControls,
      selectedNodeId: null,
      nodes: [],
    }),
  emptyGraph: (): ReactElement =>
    createElement(GraphToolbar, {
      capabilities: RENDERER_CAPABILITIES.force2d!,
      controls: null,
      selectedNodeId: null,
      nodes: [],
    }),
} as const;
