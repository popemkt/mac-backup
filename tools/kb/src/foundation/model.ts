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
  /** Query nodes as pure system nodes (DESIGN-REFINE §2 W4). */
  queryTag: "sys.tag.query",
  queryField: "sys.f.query",
  queryLimitField: "sys.f.query.limit",
  /** Virtual root for saved queries (.kb/queries/*.edn); never in jsonl. */
  queriesRoot: "sys.queries",
} as const;

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
