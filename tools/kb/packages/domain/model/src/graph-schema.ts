/** Stable graph vocabulary. Presets reference these ordinary option nodes or field nodes. */
export const GRAPH_RENDERER_VALUES = {
  force2d: { id: "sys.graph.renderer.force2d", label: "2D" },
  tree: { id: "sys.graph.renderer.tree", label: "Tree" },
  cluster: { id: "sys.graph.renderer.cluster", label: "Cluster" },
  force3d: { id: "sys.graph.renderer.force3d", label: "3D" },
  treemap: { id: "sys.graph.renderer.treemap", label: "Treemap" },
} as const;

export const GRAPH_SOURCE_VALUES = {
  tag: { id: "sys.graph.source.tags", label: "Tags", kind: "category" },
  parent: { id: "sys.graph.source.parent", label: "Containing node", kind: "category" },
  none: { id: "sys.graph.source.none", label: "No grouping", kind: "category" },
  degree: { id: "sys.graph.source.degree", label: "Connection count", kind: "number" },
  children: { id: "sys.graph.source.child-count", label: "Contained node count", kind: "number" },
  fixed: { id: "sys.graph.source.uniform", label: "Equal size", kind: "number" },
  text: { id: "sys.graph.source.text", label: "Node text", kind: "label" },
  child: { id: "sys.graph.source.containment", label: "Contains", kind: "relationship" },
  mention: { id: "sys.graph.source.mentions", label: "Text references", kind: "relationship" },
  "ref-prop": {
    id: "sys.graph.source.references",
    label: "All reference fields",
    kind: "relationship",
  },
} as const;
export type GraphSourceKind = "category" | "number" | "label" | "relationship";

export function graphSourceKey(id: string): string {
  return (
    Object.entries(GRAPH_SOURCE_VALUES).find(([, value]) => value.id === id)?.[0] ?? `prop:${id}`
  );
}
export function graphSourceId(key: string): string | null {
  if (key.startsWith("prop:")) return key.slice(5);
  return Object.entries(GRAPH_SOURCE_VALUES).find(([name]) => name === key)?.[1].id ?? null;
}
export function graphRendererKey(id: string): string {
  return Object.entries(GRAPH_RENDERER_VALUES).find(([, value]) => value.id === id)?.[0] ?? id;
}
export function graphRendererId(key: string): string {
  return Object.entries(GRAPH_RENDERER_VALUES).find(([name]) => name === key)?.[1].id ?? key;
}
