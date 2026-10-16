/**
 * `@kb/outline-ui`: the outline family's browser half (DESIGN.md → Extension
 * families; DESIGN-UI.md → Outline): the outline page, its frame views, its
 * snippet, its sidebar sections and node commands. It reaches the page only
 * through `@kb/ui-sdk`'s `BrowserHost`. The page loads its entry,
 * `outlineUiPlugin`, through `BROWSER_EXTENSIONS` under the family's declared
 * name, from the main bundle; the outline is a required family, so it is
 * always loaded.
 */
export { outlineUiPlugin } from "./plugin";

// The outline's parts the page's own tests drive (the outline page tests in
// `@kb/ui`, which run in the shell): its store and projection, its editor
// and rows, its frame views and their layout, and its value editors.
// GAP [[01M531QT1YPM9NTF6NKH9BP66S]]
export { backlinkRows } from "./backlinks";
export { BoardCardsView } from "./board-cards-view";
export { longDateLabel, relativeDateLabel } from "./date-display";
export { createTransientNode, mergeWithPrevious } from "./editing-writes";
export { FieldsSection, FieldValueStack } from "./fields-section";
export {
  applyViewFilters,
  flattenBoardOrder,
  groupChildrenForBoard,
  resolveTableColumns,
  sortChildrenForTable,
} from "./frame-layout";
export { frameRows, type FrameRowsInput } from "./frame-rows";
export { FrameViewSlot } from "./frame-view-slot";
export { NodeBlock } from "./node-block";
export { NodeCommandPalette } from "./node-command-palette";
export { formatNumber, numberEditText } from "./number-format";
export { OutlineEditor } from "./outline-editor";
export { setOutlineHost } from "./outline-hosts";
export {
  initialOutlineState,
  outlineNodes,
  outlineProjection,
  outlineSource,
  type OutlineStateData,
  useOutlineNode,
  useOutlineStore,
} from "./outline.store";
export { notePick, recentPicks } from "./picker-recency";
export { QueryResultsSection } from "./query-results";
export { ReferencesView } from "./references-section";
export { resolveRowChrome } from "./row-chrome";
export { TableView } from "./table-view";
export { useNodeKeyDown } from "./use-node-keydown";
export { useSelectionKeymap } from "./use-selection-keymap";
export { ValueSlot } from "./value-slot";
export { fieldGlyphOf } from "./value-views";
export { listFilterFieldOptions } from "./view-filter-fields";
export { ViewFilterPopoverHost } from "./view-filter-popover";
export { ViewToolbar } from "./view-toolbar";
export { collectVisibleInstances } from "./visible-instances";
export { ZoomedRootHeader } from "./zoomed-root-header";
