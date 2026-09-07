/**
 * Three-way merge of the node store, by node id.
 *
 * ULIDs cluster newly created nodes at the tail of `nodes.jsonl`, so two
 * branches that each add a node collide on adjacent lines and git's line-based
 * merge reports a conflict that is not one. The store is a set of nodes keyed
 * by id, and that is the unit a merge should reason about: two sides conflict
 * when they changed the same node to different things, and only then.
 *
 * The resolution rules, in the order they are tried:
 *
 *  1. Both sides agree (including "both deleted it") — take that.
 *  2. One side still matches the base — it did not touch this node, so the
 *     other side's version wins. A deletion is a change like any other, so a
 *     side deleting a node the other side left alone is honoured.
 *  3. Both sides changed it and both still have it — the newer `updatedAt`
 *     wins. Node stamps are the store's own record of which edit came second.
 *  4. Anything left is a real disagreement — one side deleted what the other
 *     edited, or both edited to the same timestamp. Those are reported, not
 *     guessed at.
 */
import { canonicalJson } from "./canonical.ts";
import type { KbNode } from "./model.ts";

/** Why two sides could not be reconciled for one node id. */
export type MergeConflictReason = "deleted-and-modified" | "modified-both-same-stamp";

export interface MergeConflict {
  id: string;
  reason: MergeConflictReason;
}

export interface MergeResult {
  /**
   * The merged node set — always complete and loadable. A conflicted id keeps
   * whichever side still has the node (ours first), so a conflict never
   * silently loses content; it asks a human to choose again.
   */
  nodes: KbNode[];
  /** Empty when the merge is clean. */
  conflicts: MergeConflict[];
}

/** A node's identity as bytes, so "unchanged" is a string comparison. */
function bytesOf(node: KbNode | undefined): string | undefined {
  return node === undefined ? undefined : canonicalJson(node);
}

function byId(nodes: readonly KbNode[]): Map<string, KbNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/**
 * Merge `ours` and `theirs` against their common ancestor `base`.
 *
 * The result is always a complete, valid node set, and the conflicting ids are
 * named for a human to reconcile.
 */
export function mergeNodeSets(
  base: readonly KbNode[],
  ours: readonly KbNode[],
  theirs: readonly KbNode[],
): MergeResult {
  const baseById = byId(base);
  const oursById = byId(ours);
  const theirsById = byId(theirs);

  const nodes: KbNode[] = [];
  const conflicts: MergeConflict[] = [];

  for (const id of new Set([...baseById.keys(), ...oursById.keys(), ...theirsById.keys()])) {
    const o = baseById.get(id);
    const a = oursById.get(id);
    const b = theirsById.get(id);
    const [ob, ab, bb] = [bytesOf(o), bytesOf(a), bytesOf(b)];

    if (ab === bb) {
      if (a !== undefined) nodes.push(a);
      continue;
    }
    if (ab === ob) {
      if (b !== undefined) nodes.push(b);
      continue;
    }
    if (bb === ob) {
      if (a !== undefined) nodes.push(a);
      continue;
    }
    if (a === undefined || b === undefined) {
      // One side deleted what the other edited. Keeping the edit would undo a
      // deliberate delete; dropping it would discard a deliberate edit.
      const survivor = a ?? b;
      if (survivor !== undefined) nodes.push(survivor);
      conflicts.push({ id, reason: "deleted-and-modified" });
      continue;
    }
    if (a.updatedAt === b.updatedAt) {
      nodes.push(a);
      conflicts.push({ id, reason: "modified-both-same-stamp" });
      continue;
    }
    nodes.push(a.updatedAt > b.updatedAt ? a : b);
  }

  return { nodes, conflicts };
}
