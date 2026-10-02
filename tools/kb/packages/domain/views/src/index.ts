/**
 * Every view kb provides, as data: each view's key — its id, its option, its
 * settings as an Effect `Schema`, and how they are read from a view node's
 * props — so the UI that draws a view and the server that lists, validates
 * and renders it hold one key. DESIGN.md → Kinds, roles and options → View
 * nodes states the model; DESIGN-UI.md → UI points: routes and views states
 * the contract a view keeps.
 */
export {
  NoParams,
  localIdOf,
  paramsFrom,
  paramsFromProps,
  paramsIssues,
  issueText,
  viewKey,
  type ConfigReport,
  type ParamsOf,
  type PlainViewKey,
  type ViewConfigReader,
  type ViewIssue,
  type ViewKey,
} from "./view-key.ts";
export {
  DEFAULT_AUTOROTATE,
  DEFAULT_CLUSTER_BY,
  DEFAULT_COLOR_BY,
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
} from "./lens.ts";
export {
  DEFAULT_VIEW_CONFIG,
  FRAME_SETTINGS,
  FRAME_VIEW_FAMILY,
  decodeFrameConfig,
  frameSettingWrite,
  isFrameViewKey,
  parseViewFilterEdn,
  projectsRows,
  serializeViewFilter,
  type FrameViewKey,
  type FrameViewParams,
  type SortDir,
  type SortSpec,
  type ViewConfig,
  type ViewFilter,
} from "./frame.ts";
export {
  OUTLINE_NAMESPACE,
  OutlineBoardView,
  OutlineCardsView,
  OutlineListView,
  OutlineSnippetParams,
  OutlineSnippetView,
  OutlineTableView,
  OutlineView,
} from "./outline.ts";
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
  type GraphChannel,
  type RendererCapabilities,
  type RendererKey,
  type RendererTraits,
} from "./graph.ts";
export {
  ONTOLOGY_NAMESPACE,
  ONTOLOGY_VIEWS,
  OntologyListView,
  OntologyScopeParams,
  OntologyScopeView,
  type OntologyView,
} from "./ontology.ts";
export { CANVAS_NAMESPACE, CanvasListView, CanvasParams, CanvasView } from "./canvas.ts";
export { LAB_NAMESPACE, LAB_SCENE_IDS, LabParams, LabView, type LabSceneId } from "./lab.ts";
export { DOCS_NAMESPACE, DocsMarkdownParams, DocsMarkdownView, docsSpecOf } from "./docs.ts";
export { VIEW_CATALOG, catalogKeyOf, viewCatalog, type ViewCatalogEntry } from "./catalog.ts";
