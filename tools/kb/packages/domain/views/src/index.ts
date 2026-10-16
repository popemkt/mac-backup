/**
 * Core's views, as data: each view's key — its id, its option, its settings
 * as an Effect `Schema`, and how they are read from a view node's props — so
 * the UI that draws a view and the server that lists, validates and renders
 * it hold one key; and the machinery every key is built with (`viewKey`, the
 * lens and frame codecs, the resolver). The graph's keys are `@kb/graph`'s,
 * and a family's are its shared package's. DESIGN.md → Kinds, roles and options → View
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
  type ShownFor,
  type ViewConfigCodec,
  type ViewIssue,
  type ViewKey,
  type ViewPage,
} from "./view-key.ts";
export {
  DEFAULT_VIEW_CONFIG,
  FRAME_SETTINGS,
  FRAME_VIEW_FAMILY,
  decodeFrameConfig,
  encodeFrameConfig,
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
  OutlineParams,
  OutlineSnippetParams,
  OutlineSnippetView,
  OutlineTableView,
  OutlineView,
} from "./outline.ts";
export {
  ONTOLOGY_NAMESPACE,
  ONTOLOGY_VIEWS,
  OntologyListView,
  OntologyScopeParams,
  OntologyScopeView,
  type OntologyView,
} from "./ontology.ts";
export {
  DOCS_NAMESPACE,
  DocsMarkdownParams,
  DocsMarkdownView,
  docsSpecOf,
  docsViewNamed,
  docsViewsOf,
  type DocsView,
  type DocsViewFault,
  type DocsViews,
} from "./docs.ts";
export {
  viewCatalogOf,
  type CatalogItem,
  type ViewCatalogEntry,
  type ViewCatalogOf,
} from "./catalog.ts";
export { viewNodeFor, type ViewNodeProposal } from "./view-node.ts";
export { SUBJECT_SLOTS, subjectRootOf, subjectRootProps } from "./subject.ts";
export {
  LAYOUT_NAMESPACE,
  LayoutParams,
  LayoutView,
  NodeParams,
  NodeView,
  SPLIT_DIRECTIONS,
  closePane,
  decodeLayout,
  findPane,
  freshPaneId,
  layoutPanes,
  neighbourOf,
  normalizeLayout,
  openBeside,
  sameLayout,
  singlePane,
  withPanePath,
  type LayoutPane,
  type LayoutSplit,
  type LayoutTabs,
  type LayoutTree,
  type SplitDirection,
} from "./layout.ts";
export {
  resolveNodeView,
  viewNamed,
  type HeldViewTarget,
  type NamedView,
  type BrokenViewTarget,
  type NodeViewTarget,
  type UnheldViewTarget,
} from "./node-view.ts";
