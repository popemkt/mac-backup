import type { WireNode } from "@kb/protocol";

/** Virtual forest root — not present in the graph snapshot. */
export const WORKSPACE_ROOT_ID = "__kb_root__";

export const SYSTEM_IDS = {
  field: "sys.field",
  tag: "sys.tag",
  typeField: "sys.f.type",
  fieldsField: "sys.f.fields",
  command: "sys.command",
  cmdAddNode: "sys.cmd.add-node",
  cmdAddTag: "sys.cmd.add-tag",
  cmdDefineField: "sys.cmd.define-field",
  cmdGoQuery: "sys.cmd.go-query",
  cmdNewQuery: "sys.cmd.new-query",
} as const;

/** Any reserved / seeded id under the `sys.` prefix. */
export function isSysPrefixed(id: string): boolean {
  return id.startsWith("sys.");
}

export const COLLAPSE_STORAGE_KEY = "kb-ui:collapsed";

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
}

export type NodeMap = Map<string, OutlineNode>;

export interface ResolvedProp {
  fieldId: string;
  fieldName: string;
  values: PropValue[];
}
