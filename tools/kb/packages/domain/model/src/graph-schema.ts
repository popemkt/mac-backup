import { SYSTEM_IDS } from "./model.ts";

/**
 * Stable graph vocabulary. Perspectives reference these ordinary option nodes
 * or field nodes.
 *
 * The ids are the seed's, and the seed derives the nodes from here — this file
 * is the TypeScript side of one declaration, not a second list. Two things it
 * owns beyond the labels, because both were previously written down twice:
 *
 * - a source's **kind** (category / number / label / relationship), which used
 *   to live only here while the store held it nowhere, so the option set could
 *   not be partitioned by a query. It is now a seeded field on each option node
 *   ({@link GRAPH_SOURCE_KIND_OPTION_IDS}) and this map is what seeds it.
 * - which kind each lens field selects from ({@link GRAPH_SOURCE_FIELD_KINDS}),
 *   which the seed turns into five `targetQuery`s and the graph page turns into
 *   five option lists.
 */
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

/**
 * Declared order, which becomes the option order the `kind` picker shows —
 * written out rather than read back from the values above, which would erase
 * the literal types (same reason as `FIELD_TYPES`).
 */
export const GRAPH_SOURCE_KINDS: readonly GraphSourceKind[] = [
  "category",
  "number",
  "label",
  "relationship",
];

/** Kind -> option node id. The four are children of `sys.f.graph.source.kind`. */
export const GRAPH_SOURCE_KIND_OPTION_IDS: Record<GraphSourceKind, string> = {
  category: "sys.graph.kind.category",
  number: "sys.graph.kind.number",
  label: "sys.graph.kind.label",
  relationship: "sys.graph.kind.relationship",
};

/**
 * The lens fields that select from the shared source list, and the kind each
 * one selects. Every consumer reads the kind from here: the seed to build the
 * field's `targetQuery`, the graph page to build its option list.
 */
export const GRAPH_SOURCE_FIELD_KINDS = {
  [SYSTEM_IDS.lensColorByField]: "category",
  [SYSTEM_IDS.lensClusterByField]: "category",
  [SYSTEM_IDS.lensSizeByField]: "number",
  [SYSTEM_IDS.lensLabelByField]: "label",
  [SYSTEM_IDS.lensEdgeKindsField]: "relationship",
} as const satisfies Record<string, GraphSourceKind>;

export type GraphSourceField = keyof typeof GRAPH_SOURCE_FIELD_KINDS;

/**
 * The option set a source-selecting lens field declares: the children of the
 * shared `sys.graph.sources` list whose `kind` is this one.
 *
 * A query, not a second copy of the list — the same shape `surface` uses to
 * select `enforcement`'s children minus `prose`. `:node/child-order` is paired
 * with `:node/child` so the picker lists options in outline order, exactly as
 * `childrenTargetQuery` does for a field's own children.
 */
export function graphSourceTargetQuery(kind: GraphSourceKind): string {
  return [
    "[:find ?id :where",
    `[?p :node/id "${SYSTEM_IDS.graphSourcesRoot}"]`,
    "[?p :node/child ?c]",
    "[?p :node/child-order ?o]",
    "[?c :node/id ?id]",
    `[?c :f/${SYSTEM_IDS.graphSourceKindField} ?k]`,
    `[?k :node/id "${GRAPH_SOURCE_KIND_OPTION_IDS[kind]}"]]`,
  ].join(" ");
}

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
