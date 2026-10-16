import { Schema } from "effect";
import { subjectRootOf, viewKey, type ViewKey } from "@kb/views";
import {
  EdgeKindSchema,
  LENS_SETTINGS,
  LensParams,
  decodeLensConfig,
  encodeLensConfig,
  type LensPerspective,
  type LensWrite,
} from "./lens.ts";

/** The graph plugin's namespace and view keys: what a host imports, never the components. */
export const GRAPH_NAMESPACE = "graph";

export const GraphParams = Schema.Struct({
  /** A graph perspective node's id; absent means the default perspective. */
  perspective: Schema.optionalKey(Schema.String),
  /** Scopes the graph to one ontology's members, when an ontology embeds it. */
  ontology: Schema.optionalKey(Schema.String),
}).annotate({
  description:
    "The graph page, drawing one graph view node (perspective) at /graph[/<perspective>]. Its params come from the route: a view node holds none.",
});
export type GraphParams = typeof GraphParams.Type;

/** The graph: its page at `/graph[/<perspective>]`, and what an ontology's graph view embeds. */
export const GraphView = viewKey(`${GRAPH_NAMESPACE}.page`, "Graph", GraphParams);

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
  /** The renderer that draws it, by its view's option (`LensRenderer`). */
  renderer: Schema.String,
  /** What the renderer draws with: the lens settings, each one's schema. */
  settings: Schema.Struct(LENS_SETTINGS),
}).annotate({
  description:
    "A node's neighbourhood: the nodes within hops of root along edges, in either direction, drawn by the renderer view whose option renderer names, with settings. Stored, root is lens.focus, else the node it is shown for.",
});
export type NeighbourhoodParams = typeof NeighbourhoodParams.Type;

/**
 * Stored, it is a view node's lens props: `lens.focus` is the root, and an
 * empty focus means the node it is shown for; `lens.hops` (1 when absent),
 * `lens.edge-kinds`, `lens.renderer` and the renderer's settings.
 */
export const NeighbourhoodView = viewKey(
  `${GRAPH_NAMESPACE}.neighbourhood`,
  "Neighbourhood",
  NeighbourhoodParams,
  {
    read: (props, host, report) => {
      const lens = decodeLensConfig(props, report);
      return {
        root: subjectRootOf(props, host),
        hops: lens.hops ?? 1,
        edges: lens.edgeKinds,
        renderer: lens.renderer,
        settings: lens,
      };
    },
    write: ({ root, hops, edges, renderer, settings }) =>
      encodeLensConfig({ ...settings, focus: root, hops, edgeKinds: edges, renderer }),
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
 * are the lens it draws through (`LensParams`) and the lens settings it reads
 * — `LENS_SETTINGS` entries, so asking which settings it reads is asking its
 * params. Its `option` is what a graph view node's `sys.f.view` names it by.
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

type RendererName = "force2d" | "tree" | "cluster" | "force3d" | "treemap";

function rendererKey<P extends LensWrite>(
  name: RendererName,
  label: string,
  params: RendererKey<P>["params"],
  traits: RendererTraits,
): RendererKey<P> {
  return {
    // A renderer's settings are the lens props of the perspective it draws.
    ...viewKey<P>(`${GRAPH_NAMESPACE}.${name}`, label, params, {
      read: (props, _host, report) => decodeLensConfig(props, report),
      write: encodeLensConfig,
    }),
    family: RENDERER_FAMILY,
    params,
    renderer: traits,
    // A renderer draws inside the graph page, which draws the view node it is shown through.
    page: ({ viewNode }) =>
      viewNode === null ? null : { key: GraphView, input: { perspective: viewNode } },
  };
}

/**
 * A renderer's params: the lens every renderer draws through, then the
 * settings this one reads, described by what it draws.
 */
function rendererParams<const S extends Schema.Struct.Fields>(settings: S, draws: string) {
  return Schema.Struct({ ...LensParams.fields, ...settings }).annotate({
    description: `${draws}. A graph renderer: a graph view node names it as its view (sys.f.view) and holds its params, the lens (which nodes it draws, and how they map to marks) and this renderer's settings.`,
  });
}

/**
 * What `perspective` proposes as a view node of `renderer`: each param the
 * renderer declares (the lens and its own settings), as the perspective holds
 * it. A setting another renderer reads is not this view's, so it is not held.
 */
export function rendererParamsOf(
  renderer: RendererKey<unknown>,
  perspective: LensPerspective,
): Record<string, unknown> {
  const held = new Map<string, unknown>(Object.entries(perspective));
  return Object.fromEntries(
    Object.keys(renderer.params.fields).flatMap((param) => {
      const value = held.get(param);
      return value === undefined ? [] : [[param, value]];
    }),
  );
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
  "2D",
  rendererParams(
    {
      layout: LENS_SETTINGS.layout,
      labelDensity: LENS_SETTINGS.labelDensity,
      showLabels: LENS_SETTINGS.showLabels,
      theme: LENS_SETTINGS.theme,
      linkStyle: LENS_SETTINGS.linkStyle,
    },
    "Force-directed 2D",
  ),
  {
    capabilities: { ...standard, drag: true },
    channels: ["relationships", "color", "label", "size"],
  },
);

/** A spanning tree of the chosen edges. */
export const TreeView = rendererKey(
  "tree",
  "Tree",
  rendererParams({ showLabels: LENS_SETTINGS.showLabels }, "A spanning tree of the chosen edges"),
  {
    capabilities: { ...standard, drag: false },
    channels: ["relationships", "color", "label"],
  },
);

/** The 2D force layout, grouped into hulls. */
export const ClusterView = rendererKey(
  "cluster",
  "Cluster",
  rendererParams(
    {
      labelDensity: LENS_SETTINGS.labelDensity,
      showLabels: LENS_SETTINGS.showLabels,
      theme: LENS_SETTINGS.theme,
      linkStyle: LENS_SETTINGS.linkStyle,
    },
    "The 2D force layout, grouped into hulls",
  ),
  {
    capabilities: { ...standard, drag: true },
    channels: ["relationships", "color", "label", "size", "group"],
  },
);

/** Force-directed 3D, on the scene kit. */
export const Force3dView = rendererKey(
  "force3d",
  "3D",
  rendererParams(
    {
      spread: LENS_SETTINGS.spread,
      linkDistance: LENS_SETTINGS.linkDistance,
      labelDensity: LENS_SETTINGS.labelDensity,
      showLabels: LENS_SETTINGS.showLabels,
      autorotate: LENS_SETTINGS.autorotate,
      theme: LENS_SETTINGS.theme,
      linkStyle: LENS_SETTINGS.linkStyle,
    },
    "Force-directed 3D",
  ),
  {
    capabilities: { ...standard, drag: false },
    linkMotion: true,
    channels: ["relationships", "color", "label", "size"],
  },
);

/** Area by the size encoding, boxed by the group encoding. */
export const TreemapView = rendererKey(
  "treemap",
  "Treemap",
  rendererParams(
    { showLabels: LENS_SETTINGS.showLabels },
    "Area by the size encoding, boxed by the group encoding",
  ),
  {
    capabilities: { ...standard, fit: false, zoom: false, reset: false, focus: false },
    channels: ["color", "size", "group", "label"],
  },
);
