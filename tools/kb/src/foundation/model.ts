/** Node identity: ULID, or reserved `sys.*` system ids. */
export type NodeId = string;

/**
 * Property values keyed by field-node id.
 * Refs point at other nodes by NodeId.
 */
export type PropValue =
  | { t: "str" | "num" | "bool" | "date"; v: string | number | boolean }
  | { t: "ref"; v: NodeId };

/** Everything is a node — fields and tags included. */
export interface KbNode {
  id: NodeId;
  text: string;
  /** key = FIELD NODE id, not a display name */
  props: Record<NodeId, PropValue[]>;
  /** ordered outline children */
  children: NodeId[];
  createdAt: string;
  updatedAt: string;
}

export const SYSTEM_IDS = {
  field: "sys.field",
  tag: "sys.tag",
  typeField: "sys.f.type",
  fieldsField: "sys.f.fields",
  /** Optional chip color on tag definition nodes (DESIGN-RESKIN §1.8). */
  colorField: "sys.f.color",
  /** Per-field visibility: when true, field rows are hidden unless debug mode. */
  hiddenField: "sys.f.hidden",
  /** Declared value type on field nodes (text|number|date|url|checkbox|ref). */
  fieldTypeField: "sys.f.fieldType",
  /** Ref constraint sugar: allowed target tag(s), multi = union. */
  targetTagField: "sys.f.targetTag",
  /** Ref constraint general form: EDN datalog of allowed node ids (wins over tag). */
  targetQueryField: "sys.f.targetQuery",
  /** Type node for palette command nodes (DESIGN-REFINE §2 W3). */
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
  /** Virtual root for saved queries (.kb/queries/*.edn); never in jsonl. */
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

export type SystemId = (typeof SYSTEM_IDS)[keyof typeof SYSTEM_IDS];

export function isSystemId(id: string): id is SystemId {
  return (Object.values(SYSTEM_IDS) as string[]).includes(id);
}

/** Any reserved / seeded id under the `sys.` prefix (browse yes, break no). */
export function isSysPrefixed(id: string): boolean {
  return id.startsWith("sys.");
}

export function nowIso(): string {
  return new Date().toISOString();
}
