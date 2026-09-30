import { Schema } from "effect";
import type { GRAPH_RENDERER_VALUES } from "@kb/model";
import { EdgeKindSchema, LENS_SETTINGS, lensConfig } from "@/lib/graph-lens";
import { viewKey, type ViewKey } from "@/lib/view-key";

/** The graph plugin's namespace and view keys: what a host imports, never the components. */
export const GRAPH_NAMESPACE = "graph";

export const GraphParams = Schema.Struct({
  /** A graph perspective node's id; absent means the default perspective. */
  perspective: Schema.optionalKey(Schema.String),
  /** Scopes the graph to one ontology's members, when an ontology embeds it. */
  ontology: Schema.optionalKey(Schema.String),
});
export type GraphParams = typeof GraphParams.Type;

/** The graph: its page at `/graph[/<perspective>]`, and what an ontology's graph view embeds. */
export const GraphView = viewKey(`${GRAPH_NAMESPACE}.page`, GraphParams);

/**
 * A node's neighbourhood: the nodes within `hops` of `root` along `edges`, in
 * either direction, drawn by the renderer `renderer` names with `settings`. A
 * graph perspective narrowed to a focus and a hop bound, so the same
 * extraction the graph page runs, over a smaller node set.
 */
export const NeighbourhoodParams = Schema.Struct({
  root: Schema.NonEmptyString,
  hops: Schema.Literals([1, 2, 3, 4]),
  edges: Schema.Array(EdgeKindSchema),
  /** The renderer's local id (`force2d`, `tree`, …). */
  renderer: Schema.String,
  /** What the renderer draws with: the lens settings, each one's schema. */
  settings: Schema.Struct(LENS_SETTINGS),
});
export type NeighbourhoodParams = typeof NeighbourhoodParams.Type;

/**
 * Stored, it is a view node's lens props: `lens.focus` is the root, and an
 * empty focus means the node it is shown for; `lens.hops` (1 when absent),
 * `lens.edge-kinds`, `lens.renderer` and the renderer's settings.
 */
export const NeighbourhoodView = viewKey(
  `${GRAPH_NAMESPACE}.neighbourhood`,
  NeighbourhoodParams,
  (props, host) => {
    const lens = lensConfig(props);
    return {
      root: lens.focus ?? host ?? undefined,
      hops: lens.hops ?? 1,
      edges: lens.edgeKinds,
      renderer: lens.renderer,
      settings: lens,
    };
  },
);

/**
 * What the shared frame chrome may drive for a renderer.
 * Unsupported controls must render disabled with a reason — never look live
 * and no-op (r10 §3.2 / i13 Task 0).
 */
export interface RendererCapabilities {
  fit: boolean;
  zoom: boolean;
  reset: boolean;
  focus: boolean;
  search: boolean;
  selection: boolean;
  dim: boolean;
  drag: boolean;
}

/** An encoding the settings panel offers a renderer: the edge kinds, or one mapping. */
export type GraphChannel = "relationships" | "color" | "size" | "group" | "label";

/** What a renderer is to the graph frame around it, beyond the settings it reads. */
export interface RendererTraits {
  readonly capabilities: RendererCapabilities;
  readonly channels: readonly GraphChannel[];
  /** Whether it can move a link (a flowing link style's dashes); others draw the style's shape, still. */
  readonly linkMotion?: true;
}

/**
 * A graph renderer's key: a view of the graph a host extracted, whose params
 * are the lens settings it reads — a `Schema.Struct` of `LENS_SETTINGS`
 * entries, so asking which settings it reads is asking its params. Its local
 * id is the renderer's name in `lens.renderer`.
 */
export interface RendererKey<P> extends ViewKey<P> {
  readonly family: typeof RENDERER_FAMILY;
  readonly params: Schema.Decoder<P> & { readonly fields: Schema.Struct.Fields };
  readonly renderer: RendererTraits;
}

/** The discriminant a graph renderer's key carries (`ViewKey.family`). */
const RENDERER_FAMILY = "graph.renderer";

/** Whether a view's key is a graph renderer's: what a renderer picker lists. */
export function isRendererKey(key: ViewKey<unknown>): key is RendererKey<unknown> {
  return key.family === RENDERER_FAMILY;
}

type RendererName = keyof typeof GRAPH_RENDERER_VALUES;

function rendererKey<P>(
  name: RendererName,
  params: RendererKey<P>["params"],
  traits: RendererTraits,
): RendererKey<P> {
  return {
    // A renderer's settings are the lens props of the perspective it draws.
    ...viewKey(`${GRAPH_NAMESPACE}.${name}`, params, (props) => lensConfig(props)),
    family: RENDERER_FAMILY,
    params,
    renderer: traits,
  };
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

/** Force-directed 2D, on sigma. */
export const Force2dView = rendererKey(
  "force2d",
  Schema.Struct({
    layout: LENS_SETTINGS.layout,
    labelDensity: LENS_SETTINGS.labelDensity,
    showLabels: LENS_SETTINGS.showLabels,
    theme: LENS_SETTINGS.theme,
    linkStyle: LENS_SETTINGS.linkStyle,
  }),
  {
    capabilities: { ...standard, drag: true },
    channels: ["relationships", "color", "label", "size"],
  },
);

/** A spanning tree of the chosen edges. */
export const TreeView = rendererKey(
  "tree",
  Schema.Struct({ showLabels: LENS_SETTINGS.showLabels }),
  {
    capabilities: { ...standard, drag: false },
    channels: ["relationships", "color", "label"],
  },
);

/** The 2D force layout, grouped into hulls. */
export const ClusterView = rendererKey(
  "cluster",
  Schema.Struct({
    labelDensity: LENS_SETTINGS.labelDensity,
    showLabels: LENS_SETTINGS.showLabels,
    theme: LENS_SETTINGS.theme,
    linkStyle: LENS_SETTINGS.linkStyle,
  }),
  {
    capabilities: { ...standard, drag: true },
    channels: ["relationships", "color", "label", "size", "group"],
  },
);

/** Force-directed 3D, on the scene kit. */
export const Force3dView = rendererKey(
  "force3d",
  Schema.Struct({
    spread: LENS_SETTINGS.spread,
    linkDistance: LENS_SETTINGS.linkDistance,
    labelDensity: LENS_SETTINGS.labelDensity,
    showLabels: LENS_SETTINGS.showLabels,
    autorotate: LENS_SETTINGS.autorotate,
    theme: LENS_SETTINGS.theme,
    linkStyle: LENS_SETTINGS.linkStyle,
  }),
  {
    capabilities: { ...standard, drag: false },
    linkMotion: true,
    channels: ["relationships", "color", "label", "size"],
  },
);

/** Area by the size encoding, boxed by the group encoding. */
export const TreemapView = rendererKey(
  "treemap",
  Schema.Struct({ showLabels: LENS_SETTINGS.showLabels }),
  {
    capabilities: { ...standard, fit: false, zoom: false, reset: false, focus: false },
    channels: ["color", "size", "group", "label"],
  },
);
