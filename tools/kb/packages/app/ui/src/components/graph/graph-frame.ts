import { createContext, useContext } from "react";
import type { Appearance } from "@/stores/prefs.store";
import type { LensGraph, LensPerspective, LensTreeNode } from "@/lib/graph-lens";
import type { GraphCameraControls } from "./graph-camera-controls";
import type { GraphSelection } from "./graph-selection";

/**
 * What a graph host hands the renderer view it draws with: the graph it
 * extracted and the frame's live interaction state. A renderer's params are
 * the lens settings it reads; this is everything else it draws from, and none
 * of it is config — so it travels beside the params, never in them.
 */
export interface GraphFrame {
  lensGraph: LensGraph;
  forest: LensTreeNode[];
  /** The perspective's identity: a renderer keeps its layout while it holds. */
  layoutKey: string;
  /**
   * The view's identity (`graphViewKey`), so view state (the tree's fold)
   * can tell a new view from a store update of the same one.
   */
  viewKey: string;
  /** What the page is painted in: a new value means the tokens hold new values. */
  appearance: Appearance;
  searchHighlight: Set<string> | null;
  filterIds: Set<string> | null;
  selection: GraphSelection | null;
  setSelection: (selection: GraphSelection | null) => void;
  setControls: (controls: GraphCameraControls | null) => void;
  onNodeOpen: (id: string) => void;
}

/** Only a graph host provides it; a renderer view outside one has nothing to draw. */
export const GraphFrameContext = createContext<GraphFrame | null>(null);

export function useGraphFrame(): GraphFrame | null {
  return useContext(GraphFrameContext);
}

/**
 * A view's identity: everything that makes the graph page show another view
 * rather than the same one updated — the perspective, its query and focus
 * (which re-roots a tree), the sys switch and the ontology.
 */
export function graphViewKey(
  perspective: Pick<LensPerspective, "id" | "query" | "focus">,
  scope: { readonly includeSystemNodes: boolean; readonly ontologyId: string | null },
): string {
  return [
    perspective.id,
    perspective.query,
    perspective.focus ?? "",
    String(scope.includeSystemNodes),
    scope.ontologyId ?? "",
  ].join("\n");
}
