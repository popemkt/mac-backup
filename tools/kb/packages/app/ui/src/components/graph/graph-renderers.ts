import type { Appearance } from "@/stores/prefs.store";
import { GRAPH_RENDERER_VALUES } from "@kb/model";
import type { LensGraph, LensPerspective, LensTreeNode } from "@/lib/graph-lens";
import type { GraphCameraControls } from "./graph-camera-controls";
import type { GraphSelection } from "./graph-selection";
import type { GraphSetting, RendererCapabilities } from "./graph-capabilities";
import { Force2dAdapter, TreeAdapter, ClusterAdapter, Force3dAdapter } from "./graph-adapters";
import { TreemapGraph } from "./treemap-graph";

export interface GraphAdapterProps {
  lensGraph: LensGraph;
  active: LensPerspective;
  forest: LensTreeNode[];
  /**
   * The view's identity — perspective, its query, the sys switch, the
   * ontology — so view state (the tree's fold) can tell a new view from a
   * store update of the same one.
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

export type GraphChannel = "relationships" | "color" | "size" | "group" | "label";
interface GraphRendererDefinition {
  label: string;
  capabilities: RendererCapabilities;
  settings: readonly GraphSetting[];
  channels: readonly GraphChannel[];
  Component: React.ComponentType<GraphAdapterProps>;
}
const standard: RendererCapabilities = {
  fit: true,
  zoom: true,
  reset: true,
  focus: true,
  search: true,
  selection: true,
  dim: true,
  drag: false,
};

/** One registration owns rendering, mappings, settings and interaction support. */
// GAP [[01M3EZRFJ9RYFJJ4MW322RQ28S]] — each renderer should be a ViewPoint view, not a local registry
export const GRAPH_RENDERERS: Record<string, GraphRendererDefinition> = {
  force2d: {
    label: GRAPH_RENDERER_VALUES.force2d.label,
    capabilities: { ...standard, drag: true },
    settings: ["layout", "labelDensity", "showLabels"],
    channels: ["relationships", "color", "label", "size"],
    Component: Force2dAdapter,
  },
  tree: {
    label: GRAPH_RENDERER_VALUES.tree.label,
    capabilities: { ...standard, drag: false },
    settings: ["showLabels"],
    channels: ["relationships", "color", "label"],
    Component: TreeAdapter,
  },
  cluster: {
    label: GRAPH_RENDERER_VALUES.cluster.label,
    capabilities: { ...standard, drag: true },
    settings: ["clusterBy", "labelDensity", "showLabels"],
    channels: ["relationships", "color", "label", "size", "group"],
    Component: ClusterAdapter,
  },
  force3d: {
    label: GRAPH_RENDERER_VALUES.force3d.label,
    capabilities: { ...standard, drag: false },
    settings: [
      "spread",
      "linkDistance",
      "labelDensity",
      "showLabels",
      "curvedLinks",
      "autorotate",
      "nodeLook",
      "linkStyle",
    ],
    channels: ["relationships", "color", "label", "size"],
    Component: Force3dAdapter,
  },
  treemap: {
    label: GRAPH_RENDERER_VALUES.treemap.label,
    capabilities: { ...standard, fit: false, zoom: false, reset: false, focus: false },
    settings: ["clusterBy", "showLabels"],
    channels: ["color", "size", "group", "label"],
    Component: TreemapGraph,
  },
};
