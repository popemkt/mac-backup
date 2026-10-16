import type { WireNode } from "@kb/contracts";

/** Virtual forest root — not present in the graph snapshot. */
export const WORKSPACE_ROOT_ID = "__kb_root__";

import { SYSTEM_IDS } from "@kb/model";
export { SYSTEM_IDS };

/**
 * Any reserved / seeded id under the `sys.` prefix — the browser's single owner
 * of "this id is infrastructure" (core's is `isSysPrefixed` in
 * src/foundation/model.ts; this file mirrors that table rather than aliasing the
 * module, so the predicate is mirrored with it).
 *
 * It answers two questions and NOT a third. It gates **display** (an
 * unconstrained ref picker, the outline forest, the canvas card picker: offering
 * ~70 seeded nodes is useless) and it gates **writes** (`sys.*` nodes are
 * write-protected; core enforces it, `--force` overrides). It must never gate
 * **resolution** — a ref-target constraint, ontology membership, a datalog
 * result or a validity check that hides seeded nodes reports the graph as
 * something it is not. Referencing a `sys.*` node as a *value* is not a write.
 */
export function isSysPrefixed(id: string): boolean {
  return id.startsWith("sys.");
}

/** The reader's expansion, `{ open, closed }` node ids (`loadExpansion`). */
export const EXPANSION_STORAGE_KEY = "kb-expansion";
/**
 * The legacy form: node ids the reader opened. Read when `kb-expansion` is
 * absent, and never written or deleted, so an older build still reads it.
 */
export const EXPANDED_STORAGE_KEY = "kb-expanded";
/** Node ids revealing their hidden + `sys.` field rows (per-node debug). */
export const DEBUG_FIELDS_STORAGE_KEY = "kb-debug-fields";

export type PropValue = WireNode["props"][string][number];

// GAP [[01M53GQC1V4S043899SSX8Q47J]] the kit's node type is named for the outline
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

export type NodeMap = ReadonlyMap<string, OutlineNode>;

export interface ResolvedProp {
  fieldId: string;
  fieldName: string;
  values: PropValue[];
  /** Muted debug row when show-all-fields is on. */
  debug?: boolean;
}
