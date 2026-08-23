import { createElement, createRef, type ReactElement } from "react";
import type Sigma from "sigma";
import { GraphToolbar } from "@/components/graph/graph-toolbar";

/** Catalog: GraphToolbar — idle / with search open (via default idle chrome). */
export const stories = {
  idle: (): ReactElement =>
    createElement(GraphToolbar, {
      sigmaRef: createRef<Sigma | null>(),
      selectedNodeId: null,
      nodeIds: ["n.a", "n.b", "n.c"],
    }),
  withSelection: (): ReactElement =>
    createElement(GraphToolbar, {
      sigmaRef: createRef<Sigma | null>(),
      selectedNodeId: "n.a",
      nodeIds: ["n.a", "n.b"],
    }),
  emptyGraph: (): ReactElement =>
    createElement(GraphToolbar, {
      sigmaRef: createRef<Sigma | null>(),
      selectedNodeId: null,
      nodeIds: [],
    }),
} as const;
