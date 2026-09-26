/**
 * Three-way merge of the node store, by node id and, within a node, by
 * concern: existence, content and position. The rules are stated once, in
 * DESIGN.md → Merge; this file is their one implementation.
 *
 * ULIDs cluster newly created nodes at the tail of `nodes.jsonl`, so two
 * branches that each add a node collide on adjacent lines and git's line-based
 * merge reports a conflict that is not one. The store is a set of nodes keyed
 * by id, and that is the unit a merge reasons about.
 */
import { canonicalJson } from "./canonical.ts";
import type { KbNode, NodeId } from "./model.ts";
import { compareRootOrder, rankTx } from "./order.ts";

/** Why two sides could not be reconciled for one node id. */
export type MergeConflictReason =
  | "deleted-and-modified"
  | "modified-both-same-stamp"
  | "modified-both-position";

export interface MergeConflict {
  id: string;
  reason: MergeConflictReason;
}

export interface MergeResult {
  /**
   * The merged node set — always a complete, loadable, well-ranked store. A
   * conflicted id keeps one side's value (ours when both have one), so a
   * conflict never silently loses content; it asks a human to choose again.
   */
  nodes: KbNode[];
  /** Empty when the merge is clean. */
  conflicts: MergeConflict[];
}

/** Where a node sits: its parent and its rank, one concern. */
interface Position {
  readonly parent: NodeId | null;
  readonly order: string | undefined;
}

type Content = Omit<KbNode, "order" | "children" | "updatedAt">;

/** A living node while the merge is deciding it. */
interface Merged {
  content: Content;
  updatedAt: string;
  position: Position;
}

/** One side as the store would commit it: ranked, with each node's parent. */
interface Side {
  readonly nodes: ReadonlyMap<NodeId, KbNode>;
  readonly parents: ReadonlyMap<NodeId, NodeId>;
}

function readSide(nodes: readonly KbNode[]): Side {
  const ranked = new Map(
    rankTx([], { upserts: [...nodes], deletes: [] }).upserts.map((n) => [n.id, n]),
  );
  const parents = new Map<NodeId, NodeId>();
  for (const node of ranked.values()) {
    for (const child of node.children) if (ranked.has(child)) parents.set(child, node.id);
  }
  return { nodes: ranked, parents };
}

function contentOf(node: KbNode): Content {
  const { order: _order, children: _children, updatedAt: _updatedAt, ...content } = node;
  return content;
}

function positionIn(side: Side, id: NodeId): Position | undefined {
  const node = side.nodes.get(id);
  return node === undefined
    ? undefined
    : { parent: side.parents.get(id) ?? null, order: node.order };
}

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Which side's value a concern takes: the one that changed it, or `both`. */
function changedBy(base: unknown, ours: unknown, theirs: unknown): "ours" | "theirs" | "both" {
  if (same(ours, theirs) || same(theirs, base)) return "ours";
  if (same(ours, base)) return "theirs";
  return "both";
}

/** Conflicts in the order found, each (id, reason) once. */
class Conflicts {
  readonly list: MergeConflict[] = [];
  private readonly reported = new Set<NodeId>();

  add(id: NodeId, reason: MergeConflictReason): void {
    if (this.list.some((c) => c.id === id && c.reason === reason)) return;
    this.list.push({ id, reason });
    this.reported.add(id);
  }

  has(id: NodeId): boolean {
    return this.reported.has(id);
  }
}

/** One merge in progress: the living nodes, and what it could not decide. */
class NodeMerge {
  readonly living = new Map<NodeId, Merged>();
  readonly conflicts = new Conflicts();
  /** Parents brought back for a living child. */
  private readonly restored = new Set<NodeId>();
  /** Nodes a cycle already settled; each is settled at most once. */
  private readonly settled = new Set<NodeId>();

  private readonly base: Side;
  private readonly ours: Side;
  private readonly theirs: Side;

  constructor(base: Side, ours: Side, theirs: Side) {
    this.base = base;
    this.ours = ours;
    this.theirs = theirs;
  }

  /** The node as `side` has it, whole. */
  private whole(side: Side, id: NodeId): Merged | undefined {
    const node = side.nodes.get(id);
    const position = positionIn(side, id);
    if (node === undefined || position === undefined) return undefined;
    return { content: contentOf(node), updatedAt: node.updatedAt, position };
  }

  /** Rule 1: existence, from the three sides alone. */
  decideExistence(): void {
    const ids = new Set([...this.base.nodes.keys(), ...this.ours.nodes.keys()]);
    for (const id of this.theirs.nodes.keys()) ids.add(id);
    for (const id of ids) {
      const before = this.whole(this.base, id);
      const ours = this.whole(this.ours, id);
      const theirs = this.whole(this.theirs, id);
      if (ours !== undefined && theirs !== undefined) {
        this.living.set(id, this.mergeConcerns(id, before, ours, theirs));
        continue;
      }
      const kept = ours ?? theirs;
      if (kept === undefined) continue;
      if (before !== undefined) {
        if (same(before.content, kept.content) && same(before.position, kept.position)) continue;
        this.conflicts.add(id, "deleted-and-modified");
      }
      this.living.set(id, kept);
    }
  }

  /** Rule 2: content and position, each three-way, for a node both sides hold. */
  private mergeConcerns(
    id: NodeId,
    before: Merged | undefined,
    ours: Merged,
    theirs: Merged,
  ): Merged {
    let contentFrom = changedBy(before?.content, ours.content, theirs.content);
    if (contentFrom === "both") {
      if (ours.updatedAt === theirs.updatedAt) this.conflicts.add(id, "modified-both-same-stamp");
      contentFrom = theirs.updatedAt > ours.updatedAt ? "theirs" : "ours";
    }
    const content = contentFrom === "theirs" ? theirs : ours;
    const later = theirs.updatedAt > ours.updatedAt ? theirs : ours;

    let positionFrom = changedBy(before?.position, ours.position, theirs.position);
    if (positionFrom === "both") {
      this.conflicts.add(id, "modified-both-position");
      positionFrom = "ours";
    }
    return {
      content: content.content,
      updatedAt: same(ours.content, theirs.content) ? later.updatedAt : content.updatedAt,
      position: positionFrom === "theirs" ? theirs.position : ours.position,
    };
  }

  /** Rule 4: bring back gone parents and break cycles until neither applies. */
  closeForest(): void {
    for (;;) {
      this.restoreParents();
      const cycle = this.firstCycle();
      if (cycle === undefined) return;
      this.adoptOurs(cycle);
    }
  }

  private restoreParents(): void {
    const pending = [...this.living.keys()];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      const parent = this.living.get(id)?.position.parent;
      if (parent === null || parent === undefined || this.living.has(parent)) continue;
      // The side the position came from holds the parent; the other deleted it.
      const kept = this.whole(this.ours, parent) ?? this.whole(this.theirs, parent);
      if (kept === undefined) continue;
      if (!this.conflicts.has(id) && !this.restored.has(id)) {
        this.conflicts.add(parent, "deleted-and-modified");
      }
      this.restored.add(parent);
      this.living.set(parent, kept);
      pending.push(parent);
    }
  }

  private firstCycle(): NodeId[] | undefined {
    const done = new Set<NodeId>();
    for (const start of this.living.keys()) {
      const path: NodeId[] = [];
      const onPath = new Set<NodeId>();
      let at: NodeId | null | undefined = start;
      while (at !== null && at !== undefined && !done.has(at)) {
        if (onPath.has(at)) return path.slice(path.indexOf(at));
        path.push(at);
        onPath.add(at);
        at = this.living.get(at)?.position.parent;
      }
      for (const id of path) done.add(id);
    }
    return undefined;
  }

  private adoptOurs(cycle: readonly NodeId[]): void {
    let adopted = false;
    for (const id of cycle) {
      const ours = positionIn(this.ours, id);
      const merged = this.living.get(id);
      if (this.settled.has(id) || ours === undefined || merged === undefined) continue;
      if (same(ours, merged.position)) continue;
      merged.position = ours;
      this.settled.add(id);
      this.conflicts.add(id, "modified-both-position");
      adopted = true;
    }
    if (adopted) return;
    // Every node on the cycle already sits where ours has it: ours is not a
    // forest. No store gets here; the least id becomes a root.
    const least = [...cycle].toSorted()[0];
    const merged = least === undefined ? undefined : this.living.get(least);
    if (least === undefined || merged === undefined) return;
    merged.position = { ...merged.position, parent: null };
    this.settled.add(least);
    this.conflicts.add(least, "modified-both-position");
  }

  /** Rule 3: every parent's children, derived from the merged positions. */
  nodes(): KbNode[] {
    const groups = new Map<NodeId, { id: NodeId; order: string | undefined }[]>();
    for (const [id, { position }] of this.living) {
      if (position.parent === null) continue;
      const group = groups.get(position.parent) ?? [];
      group.push({ id, order: position.order });
      groups.set(position.parent, group);
    }
    return [...this.living].map(([id, { content, updatedAt, position }]) => {
      const children = (groups.get(id) ?? []).toSorted(compareRootOrder).map((c) => c.id);
      const node: KbNode = { ...content, updatedAt, children };
      if (position.order !== undefined) node.order = position.order;
      return node;
    });
  }
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
  const merge = new NodeMerge(readSide(base), readSide(ours), readSide(theirs));
  merge.decideExistence();
  merge.closeForest();
  // Rule 5: ranks settle as a commit's do.
  const nodes = rankTx([], { upserts: merge.nodes(), deletes: [] }).upserts;
  return { nodes, conflicts: merge.conflicts.list };
}
