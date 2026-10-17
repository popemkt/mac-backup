/**
 * `@kb/ui-sdk`: the host API a browser plugin builds against (DESIGN-UI.md →
 * Extension UI halves). A family's UI half imports this package and nothing
 * else of the shell. The shell builds on it too, so each piece below has one
 * home.
 *
 * It holds the UI points and the command point, the primitives, the page's
 * pure helpers, and the graph's shapes as the page holds them. The shell's
 * state (stores, writes, the invoke path) is reached only through
 * `BrowserHost`, which the shell provides; this package never imports a
 * store, and the hooks below are built over the host once.
 */

// The host, and the hooks built over it. A sandbox frame's run and handle are
// what the host's sandbox bridge takes and gives.
export {
  useAppearance,
  useDebugFieldIds,
  useDebugFields,
  useFilterFrame,
  useFollow,
  useFrameView,
  useFrameViewNode,
  useFrameViews,
  useGeneration,
  useGraphRead,
  useIndex,
  useIsActive,
  useIsSelected,
  useNode,
  useNodePaletteOpen,
  useNodes,
  useNodeTextBinding,
  useOpenNode,
  usePageBackdrop,
  type PageBackdropChoice,
  usePageGraph,
  usePaneScreen,
  usePrefs,
  usePrefsOpen,
  useQueryRows,
  useRefInk,
  useSchema,
  useSidebarToggle,
  useTheme,
  useWireNodes,
} from "./hooks";
export {
  browserHost,
  type BrowserHost,
  BrowserHostService,
  type ProposedView,
  type ViewProposal,
} from "./host";
export type { HostedFrame, SandboxEvents, SandboxPorts, SandboxRun } from "./sandbox";
// Running sandboxed code the one way: its trust, its ports and the calls
// waiting on a person, its frame, and the card a person answers them on.
export { useSandboxPorts, useSandboxTrust, type Asking, type SandboxTrust } from "./sandbox-run";
export { SandboxFrame } from "./components/sandbox-frame";
export { SandboxApprovalCard } from "./components/sandbox-approval-card";

// The UI points: routes, views, sidebar sections, docks, node commands, and
// the slot one view embeds another through.
export {
  type Command,
  type CommandContext,
  CommandPoint,
  type CommandTarget,
  nodeAction,
  type NodeCommandListing,
  type NodeCommandStep,
  type OutlineCommandApi,
  type PaletteSurface,
} from "./lib/command-point";
export {
  currentContributions,
  currentView,
  currentService,
  type Backdrop,
  BackdropPoint,
  chosenBackdrop,
  provideBackdrop,
  type BackdropPresentation,
  type BackdropProps,
  type Dock,
  DockPoint,
  type ExtensionSwitch,
  familyViews,
  findView,
  type MatchedRoute,
  matchRoute,
  type Overlay,
  OverlayPoint,
  pageFrameOf,
  paramsOf,
  type Placement,
  pointReader,
  type ProvidedView,
  providedFrameViews,
  provideRoute,
  provideView,
  type ResolvedRoute,
  RoutePoint,
  SidebarSectionPoint,
  pageFootprint,
  subscribeUiKernel,
  syncUiPlugins,
  useContributions,
  useService,
  useRoute,
  ViewPoint,
  type ViewProps,
} from "./lib/plugins";
export {
  type FamilyView,
  MAX_VIEW_DEPTH,
  type SlotChain,
  slotLink,
  slotRenders,
} from "./lib/view-key";
export { useSlotChain } from "./components/slot-chain";
export { ViewSlot } from "./components/view-slot";
export { PageBackdrop } from "./components/page-backdrop";

// The primitives.
export { Bullet } from "./components/bullet";
export { type EnumOption, EnumSelect } from "./components/enum-select";
export { FieldRow } from "./components/field-row";
export { IconButton } from "./components/icon-button";
export { InlineMarkdown, MdView } from "./components/md-view";
export { NodeRow } from "./components/node-row";
export {
  type CaretAt,
  type CaretIntent,
  NodeTextHost,
  type NodeTextHostBinding,
  type NodeTextHostProps,
} from "./components/node-text-host";
export { type NodeTextPort, useNodeTextBindingThrough } from "./components/node-text-port";
export { NoFrame } from "./components/no-frame";
export { NotFound } from "./components/not-found";
export { PickerList } from "./components/picker-list";
export { PrefFieldRow } from "./components/pref-field-row";
export { POPOVER_VALUE_CLASS, PopoverShell } from "./components/popover-shell";
export { OntologyPicker } from "./components/ontology-picker";
export { type SidebarNavItem, SidebarRow, SidebarSection } from "./components/sidebar-row";
export { SidebarToggle } from "./components/sidebar-toggle";
export { OptionChip, TagChip, TagChipGroup } from "./components/tag-chip";
export { ThemeIcon } from "./components/theme-icon";
export { useAnchoredPosition } from "./components/use-anchored-position";
export { useRevealMarkup } from "./components/use-reveal-markup";
export { ViewErrorBoundary } from "./components/view-error-boundary";
export { WorkspaceBoundary } from "./components/workspace-boundary";
export { WorkspaceState } from "./components/workspace-state";
export { ViewNotLoaded, ViewUnavailable } from "./components/view-unavailable";

// The graph as the page holds it: nodes, values, the schema and its field
// types, references, instances, perspectives, and the replica's one query seam.
export {
  contextualTargetOf,
  isContextualRef,
  rowText,
  rowTextOf,
  rowTextReadOnlyReason,
  shownNode,
  shownNodeId,
  showsAncestor,
} from "./lib/contextual-ref";
export {
  clearAllowedRefIdsCache,
  emptyValueForType,
  FIELD_TYPE_OPTION_IDS,
  FIELD_TYPES,
  type FieldType,
  fieldTypeValue,
  isValueMismatch,
  resolveAllowedRefIds,
  resolveAllowedRefIdsCached,
  resolveFieldType,
  resolveFieldTypeById,
} from "./lib/field-type";
export {
  isFieldNodeHidden,
  isIntrinsicSystemPropKey,
  resolveVisibleProps,
} from "./lib/field-visibility";
export {
  type NodeLinkEdge,
  type NodeLinkGraph,
  type NodeLinkGraphs,
  NodeLinkGraphService,
  type NodeLinkNode,
} from "./lib/node-link";
export {
  forestRootIds,
  formatPropValue,
  loadExpansion,
  loadIdSet,
  resolveProps,
  sameMeaning,
  saveExpansionChanges,
  type ExpansionChanges,
  saveIdSet,
  type Expansion,
  wireToOutlineMap,
  withExpansion,
} from "./lib/graph-view";
export {
  canvasInstanceKey,
  childInstanceKey,
  hostOfInstance,
  isProjectedInstance,
  isQueryResultInstance,
  MAIN_OUTLINE_HOST,
  outlineHostOfPane,
  outlineInstanceKey,
  queryResultInstanceKey,
} from "./lib/instance-key";
export {
  isPinned,
  listPinnedNavItems,
  listPinnedNodes,
  pinnedRefIds,
  pinnedRefIdsFor,
} from "./lib/pinned";
export { nodeCandidates, type RefCreation, refCreationOf, refSearchOf, refUses } from "./lib/refs";
export {
  fieldCarriersQuery,
  queryFieldCarriers,
  queryTaggedInstances,
  type SchemaHit,
  schemaZoomKind,
  taggedInstancesQuery,
} from "./lib/schema-zoom";
export {
  frameConfigOf,
  frameReport,
  type FrameView,
  frameViewLabelOf,
  frameViewOf,
  frameViewThrough,
  getViewConfig,
} from "./lib/frame-view";
export {
  applyViewFilters,
  EMPTY_GROUP_KEY,
  flattenBoardOrder,
  groupChildrenForBoard,
  resolveTableColumns,
  sortChildrenForTable,
  type TableColumnSpec,
} from "./lib/frame-layout";
export { frameRows, type FrameRowsInput } from "./lib/frame-rows";
export { type FieldEditorProps, FieldEditorService, useFieldEditor } from "./lib/field-editor";
export {
  type FrameRowTextProps,
  type FrameSubject,
  FrameSubjectContext,
  useFrameSubject,
} from "./lib/frame-subject";
export { isReferenceRow, resolveRowChrome } from "./lib/row-chrome";
export { type GraphRead, type GraphSource, useGraphReadThrough } from "./lib/graph-read";
export {
  type GraphChange,
  inScope,
  listOntologyItems,
  type PageGraphPort,
  type PageGraphState,
  type ScopeSource,
  scopedWireOf,
  shownNodesOf,
} from "./lib/page-graph";
export {
  EMPTY_EDITOR,
  EMPTY_PROJECTION,
  editorTextPort,
  type PageEditor,
  PageEditorService,
  type PageEditorState,
  type PageProjection,
  PageProjectionService,
} from "./lib/page-ports";
export type { PageWrites } from "./lib/page-writes";
export {
  type FieldContext,
  fieldContextOf,
  type FieldContextSource,
  type RowSource,
  type SchemaIndex,
  schemaOf,
  schemaOfGraph,
} from "./lib/schema";
export {
  DEBUG_FIELDS_STORAGE_KEY,
  EXPANDED_STORAGE_KEY,
  EXPANSION_STORAGE_KEY,
  isSysPrefixed,
  type NodeMap,
  type OutlineNode,
  type PropValue,
  SYSTEM_IDS,
  type TagBadge,
  WORKSPACE_ROOT_ID,
} from "./lib/types";
export {
  type QueryRowsSubscribe,
  resultNodeIds,
  useQueryNodeRows,
} from "./lib/use-query-node-rows";
export {
  DatascriptIndex,
  derivedWith,
  type KbIndex,
  queryBacklinks,
  queryFamilyViewNodes,
  queryNeighbourhood,
  queryRecords,
  type QueryRecords,
  runQuery,
} from "./query";

// Pure helpers: bullets, the caret, class names, colours, the DOM, keys,
// labels, logging, markdown, motion, panes, pickers, pointers, routing,
// text, themes, timing and toasts.
export {
  BULLET_GEOMETRY,
  BULLET_GLYPH,
  BULLET_GLYPHS,
  BULLET_HALO_RADIUS,
  BULLET_INK,
  BULLET_QUERY_ICON,
  BULLET_SYS_OPACITY,
  bulletAppearance,
  type BulletAppearance,
  type BulletAppearanceInput,
  type BulletPaint,
  bulletRingDash,
  type BulletShape,
  outlineBulletAppearance,
  queryHandleStart,
  queryIconPath,
} from "./lib/bullet-mode";
export {
  offsetFromPoint,
  readCaretGeometry,
  verticalArrowDecision,
  type VerticalNavDecision,
} from "./lib/caret";
export { cn, ELEVATIONS, TYPE_STEPS } from "./lib/cn";
export {
  COLOR_TOKEN_FALLBACKS,
  type ColorToken,
  oklchToRgb,
  readTokenColor,
  toRenderableColor,
} from "./lib/css-color";
export {
  asElement,
  asInstance,
  isOutside,
  isTextEntry,
  isTextNode,
  SIDEBAR_REGION_SELECTOR,
  sidebarRegionProps,
} from "./lib/dom";
export {
  bulletClickIntent,
  type CarryOutFollow,
  type Follow,
  type FollowFrom,
  type FollowHow,
  followHowOf,
  type FollowTarget,
  nodeTarget,
  OpenNodeContext,
  routePointerClick,
  useFollowThrough,
} from "./lib/follow";
export {
  graphDisplayText,
  type GraphLabelFace,
  graphLabelFont,
  wrapGraphLabel,
} from "./lib/graph-label";
export { guideLineStyle, indentStyle } from "./lib/indent";
export { keptLoad } from "./lib/kept-load";
export { type Chord, isPrintableKey, type KeyChordEvent, lookupChord } from "./lib/keychord";
export { logError, logWarn } from "./lib/log";
export {
  getCaretSerializedOffset,
  INLINE_TEXT_CLASSES,
  KB_REF_ID_ATTR,
  readInlineInput,
  type RefInk,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  serializeEditable,
  setCaretSerializedOffset,
} from "./lib/md-edit";
export { assetSrcUrl, isAssetPath, KB_TEXT_CLASS, mediaKindFromHref } from "./lib/md-inline";
export { prefersReducedMotion, useReducedMotion } from "./lib/motion";
export { MAIN_PANE, PaneContext, usePane } from "./lib/pane";
export {
  type PaneReport,
  type PaneScreenPort,
  type PaneCarryOut,
  type PaneCommand,
  type PaneSelection,
  usePaneScreenThrough,
} from "./lib/pane-screen";
export {
  CREATE_ROW_ID,
  labelRuns,
  matchCandidate,
  orderCandidates,
  type PickerCandidate,
  type PickerRow,
  pickerRows,
} from "./lib/picker";
export { pastSlop, POINTER_SLOP } from "./lib/pointer-slop";
export {
  getPath,
  navigate,
  nodePath,
  ontologyPath,
  replacePath,
  subscribePath,
} from "./lib/router";
export {
  djb2Hash,
  hashTagColor,
  nodeTagColors,
  optionColorOf,
  refInkOf,
  TAG_PALETTE,
  tagChipColors,
  tagColorAlpha,
  tagColorOf,
  tagPalette,
  type TagPalette,
  UNTAGGED_COLOR,
} from "./lib/tag-color";
export { hasText, textOr } from "./lib/text";
export {
  type Appearance,
  appearanceOf,
  DEFAULT_DESIGN_SYSTEM,
  type Prefs,
  DESIGN_SYSTEM_IDS,
  DESIGN_SYSTEMS,
  type DesignSystemId,
  type ThemePref,
  THEMES,
  type WidthPref,
  WIDTHS,
} from "./lib/theme";
export { THEME_GLYPHS } from "./lib/theme-glyphs";
export {
  approach,
  approachRate,
  approachShare,
  clampStep,
  type CubicBezier,
  easeAt,
  readTiming,
  type Spring,
  springRate,
  springResponse,
  stepSpring,
  type Timing,
  TIMING_FALLBACK,
} from "./lib/timing";
export { setToastSink, toast } from "./lib/toast";
export { usePickerKeys } from "./lib/use-picker";
export { useNarrowViewport } from "./lib/viewport";
