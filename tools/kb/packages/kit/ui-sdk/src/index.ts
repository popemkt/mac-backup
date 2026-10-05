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
  useFollow,
  useGeneration,
  useIndex,
  useIsActive,
  useNode,
  useNodes,
  usePaneScreen,
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

// The UI points: routes, views, sidebar sections, docks, node commands, and
// the slot one view embeds another through.
export {
  type Command,
  type CommandContext,
  CommandPoint,
  nodeAction,
  type NodeCommandStep,
  type OutlineCommandApi,
  type PaletteSurface,
} from "./lib/command-point";
export {
  currentContributions,
  type Dock,
  DockPoint,
  type ExtensionSwitch,
  familyViews,
  findView,
  type MatchedRoute,
  matchRoute,
  pageFrameOf,
  paramsOf,
  type Placement,
  pointReader,
  type ProvidedView,
  provideRoute,
  provideView,
  type ResolvedRoute,
  RoutePoint,
  SidebarSectionPoint,
  subscribeUiKernel,
  syncUiPlugins,
  useContributions,
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

// The primitives.
export { Bullet } from "./components/bullet";
export { type EnumOption, EnumSelect } from "./components/enum-select";
export { IconButton } from "./components/icon-button";
export { InlineMarkdown, MdView } from "./components/md-view";
export { NodeRow } from "./components/node-row";
export {
  NodeTextHost,
  type NodeTextHostBinding,
  type NodeTextHostProps,
} from "./components/node-text-host";
export { NotFound } from "./components/not-found";
export { PickerList } from "./components/picker-list";
export { POPOVER_VALUE_CLASS, PopoverShell } from "./components/popover-shell";
export { SidebarRow, SidebarSection } from "./components/sidebar-row";
export { SidebarToggle } from "./components/sidebar-toggle";
export { OptionChip, TagChip, TagChipGroup } from "./components/tag-chip";
export { ThemeIcon } from "./components/theme-icon";
export { useAnchoredPosition } from "./components/use-anchored-position";
export { useRevealMarkup } from "./components/use-reveal-markup";
export { ViewErrorBoundary } from "./components/view-error-boundary";
export { WorkspaceState } from "./components/workspace-state";

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
  buildTreeForest,
  extractLensGraph,
  lensConfig,
  type LensEdge,
  type LensGraph,
  type LensNode,
  lensReport,
  type LensTreeNode,
  listPerspectiveNodes,
  parsePerspective,
  resolvePerspective,
  resolveSize,
} from "./lib/graph-lens";
export {
  forestRootIds,
  formatPropValue,
  loadExpandedIds,
  loadIdSet,
  resolveProps,
  sameMeaning,
  saveExpandedIds,
  saveIdSet,
  wireToOutlineMap,
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
export { nodeCandidates, type RefCreation, refCreationOf, refSearchOf, refUses } from "./lib/refs";
export { type FieldContext, fieldContextOf, type SchemaIndex, schemaOf } from "./lib/schema";
export {
  DEBUG_FIELDS_STORAGE_KEY,
  EXPANDED_STORAGE_KEY,
  isSysPrefixed,
  type NodeMap,
  type OutlineNode,
  type PropValue,
  SYSTEM_IDS,
  type TagBadge,
  WORKSPACE_ROOT_ID,
} from "./lib/types";
export { type QueryRowsSubscribe, useQueryNodeRows } from "./lib/use-query-node-rows";
export {
  DatascriptIndex,
  type KbIndex,
  queryBacklinks,
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
  bulletExtent,
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
  type Follow,
  type FollowHow,
  followHowOf,
  type FollowTarget,
  nodeTarget,
  OpenNodeContext,
  routePointerClick,
} from "./lib/follow";
export {
  fitGraphLabel,
  GRAPH_LABEL_WIDTH,
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
  graphPath,
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
} from "./lib/tag-color";
export { hasText, textOr } from "./lib/text";
export {
  type Appearance,
  appearanceOf,
  BACKDROP_STRENGTHS,
  BACKDROP_OPACITY,
  BACKDROP_DIRECTIONS,
  type BackdropStrength,
  type BackdropDirection,
  DEFAULT_DESIGN_SYSTEM,
  DEFAULT_HEADER_BACKDROP,
  HEADER_BACKDROPS,
  HEADER_BACKDROP_LABELS,
  type HeaderBackdropPref,
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
