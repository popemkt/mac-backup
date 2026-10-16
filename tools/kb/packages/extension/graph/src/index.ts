/**
 * The graph family's shared package (DESIGN.md → Extension families): its
 * declaration and shared plugin, its frozen ids, schema and seed, its view
 * keys (the graph page, the renderers and a node's neighbourhood), and its
 * isomorphic projection — the edges of a node set by kind, the spanning tree
 * the tree renderers draw, the perspective a graph view node is read as, and
 * the lens its settings decode by. The browser half (`@kb/graph-ui`) and the
 * server read these same values. It is not the page's live replica (the
 * graph store), which is core.
 */
export {
  ClusterView,
  Force2dView,
  Force3dView,
  GRAPH_NAMESPACE,
  GraphParams,
  GraphView,
  NeighbourhoodParams,
  NeighbourhoodView,
  TreeView,
  TreemapView,
  isRendererKey,
  rendererParamsOf,
  type GraphChannel,
  type RendererCapabilities,
  type RendererKey,
  type RendererTraits,
} from "./views.ts";
export { collectEdges, type LensEdge, type LensSource } from "./edges.ts";
export { buildTreeForest, type LensTreeNode, type LensTreeSource } from "./tree.ts";
export { decodePerspective, resolvePerspective } from "./perspective.ts";
export {
  DEFAULT_AUTOROTATE,
  DEFAULT_CLUSTER_BY,
  DEFAULT_COLOR_BY,
  DEFAULT_FIXED_COLOR,
  DEFAULT_EDGE_KINDS,
  DEFAULT_LABEL_DENSITY,
  DEFAULT_LAYOUT,
  DEFAULT_LINK_DISTANCE,
  DEFAULT_LINK_STYLE,
  DEFAULT_MAX_NODES,
  DEFAULT_RENDERER,
  DEFAULT_SHOW_LABELS,
  DEFAULT_SIZE_BY,
  DEFAULT_SPREAD,
  DEFAULT_THEME,
  EdgeKindSchema,
  LENS_LABEL_DENSITIES,
  LENS_LAYOUTS,
  LENS_LINK_STYLES,
  LENS_SETTINGS,
  LENS_THEMES,
  decodeLensConfig,
  encodeLensConfig,
  perspectiveProps,
  sourceValue,
  type EdgeKind,
  type LensLabelDensity,
  type LensLayout,
  type LensLinkStyle,
  type LensPerspective,
  type LensProps,
  type LensRenderer,
  type LensSetting,
  type LensTheme,
  type LensWrite,
} from "./lens.ts";
export { GRAPH_IDS } from "./ids.ts";
export {
  GRAPH_LINK_STYLE_VALUES,
  GRAPH_SOURCE_FIELD_KINDS,
  GRAPH_SOURCE_KINDS,
  GRAPH_SOURCE_KIND_OPTION_IDS,
  GRAPH_SOURCE_VALUES,
  GRAPH_THEME_VALUES,
  graphOptionId,
  graphOptionKey,
  graphSourceId,
  graphSourceKey,
  graphSourceTargetQuery,
  type GraphSourceField,
  type GraphSourceKind,
} from "./schema.ts";
export { graphExtension, graphPlugin } from "./extension.ts";
