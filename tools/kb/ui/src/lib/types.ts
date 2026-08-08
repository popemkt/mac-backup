import type { WireNode } from "@kb/protocol";

/** Virtual forest root — not present in the graph snapshot. */
export const WORKSPACE_ROOT_ID = "__kb_root__";

export const SYSTEM_IDS = {
  field: "sys.field",
  tag: "sys.tag",
  typeField: "sys.f.type",
  fieldsField: "sys.f.fields",
  colorField: "sys.f.color",
  hiddenField: "sys.f.hidden",
  /** Declared value type on field nodes (text|number|date|url|checkbox|ref). */
  fieldTypeField: "sys.f.fieldType",
  /** Ref constraint sugar: allowed target tag(s), multi = union. */
  targetTagField: "sys.f.targetTag",
  /** Ref constraint general form: EDN datalog of allowed node ids (wins over tag). */
  targetQueryField: "sys.f.targetQuery",
  command: "sys.command",
  cmdAddNode: "sys.cmd.add-node",
  cmdAddTag: "sys.cmd.add-tag",
  cmdDefineField: "sys.cmd.define-field",
  cmdGoQuery: "sys.cmd.go-query",
  cmdNewQuery: "sys.cmd.new-query",
  /** Device prefs + shell commands (DESIGN-RESKIN §1.7 W8a). */
  cmdPreferences: "sys.cmd.preferences",
  cmdToggleTheme: "sys.cmd.toggle-theme",
  cmdToggleWidth: "sys.cmd.toggle-width",
  cmdDebugShowFields: "sys.cmd.debug-show-fields",
  cmdExpandAll: "sys.cmd.expand-all",
  cmdCollapseAll: "sys.cmd.collapse-all",
  /** Query nodes as pure system nodes (DESIGN-REFINE §2 W4). */
  queryTag: "sys.tag.query",
  queryField: "sys.f.query",
  queryLimitField: "sys.f.query.limit",
  /** View configuration field nodes (W7.0). */
  viewModeField: "sys.f.view.mode",
  viewSortField: "sys.f.view.sort",
  viewSortDirField: "sys.f.view.sort.dir",
  viewDisplayField: "sys.f.view.display",
  viewColwidthField: "sys.f.view.colwidth",
  viewPagesizeField: "sys.f.view.pagesize",
  /** Virtual root the ui server materializes saved queries under. */
  queriesRoot: "sys.queries",
  /** Graph perspective lenses (V0/V1 — graph-lens module). */
  graphPerspectiveTag: "sys.tag.graph-perspective",
  lensQueryField: "sys.f.lens.query",
  lensRendererField: "sys.f.lens.renderer",
  lensColorByField: "sys.f.lens.color-by",
  lensSizeByField: "sys.f.lens.size-by",
  lensEdgeKindsField: "sys.f.lens.edge-kinds",
  lensMaxNodesField: "sys.f.lens.max-nodes",
  /**
   * Default global mentions+child force2d perspective.
   * User-editable (NOT sys-prefixed) so write-guard does not lock it.
   */
  lensAllMentions: "lens.all-mentions",
} as const;

/** Pre-fix id — migrated away by ensureSystemSeed. */
export const LEGACY_LENS_ALL_MENTIONS = "sys.lens.all-mentions";

/** Any reserved / seeded id under the `sys.` prefix. */
export function isSysPrefixed(id: string): boolean {
  return id.startsWith("sys.");
}

/** Node ids the user manually expanded (default is collapsed when expandable). */
export const EXPANDED_STORAGE_KEY = "kb-expanded";
/** @deprecated migrated into EXPANDED_STORAGE_KEY on read */
export const LEGACY_COLLAPSED_STORAGE_KEY = "kb-ui:collapsed";
/** @deprecated migrated into EXPANDED_STORAGE_KEY on read */
export const LEGACY_EXPANDED_QUERIES_STORAGE_KEY = "kb-ui:expanded-queries";

export type PropValue = WireNode["props"][string][number];

/** Outline view model derived from WireNode + UI state. */
export interface OutlineNode {
  id: string;
  text: string;
  parentId: string | null;
  children: string[];
  collapsed: boolean;
  props: WireNode["props"];
  createdAt: string;
  updatedAt: string;
  /** Resolved tag badges (refs via sys.f.type that point at tag nodes). */
  tags: TagBadge[];
}

export interface TagBadge {
  id: string;
  name: string;
  /** Resolved chip + bullet color (explicit tag color prop or hash). */
  color: string;
}

export type NodeMap = Map<string, OutlineNode>;

export interface ResolvedProp {
  fieldId: string;
  fieldName: string;
  values: PropValue[];
  /** Muted debug row when show-all-fields is on. */
  debug?: boolean;
}
