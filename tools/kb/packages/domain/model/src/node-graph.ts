import type { KbNode, NodeId } from "./model.ts";
import { typeRefsOf } from "./ontology.ts";
import { compareRootOrder, siblingSlots, type SiblingGroups, type Slots } from "./order.ts";
import type { NamedNodes } from "./resolve.ts";

/**
 * A node set a write plan reads and writes into (DESIGN.md → The plan
 * graph): a node by id, the nodes of a type by text (name resolution,
 * {@link NamedNodes}), each node's parent, and every sibling group by
 * position (`SiblingGroups`), kept current as the plan writes. A plan writes
 * a node whole (`put`, as a store upsert does) or files a new child under a
 * parent (`insertChild`), and reads every node back with what was written.
 *
 * **Precondition: the set is a forest after every write** — no node is a
 * child of two nodes. A move therefore puts the old parent (child removed)
 * before the new one (child added), which is the order `node.update` emits
 * them in; `insertChild` files only a node that has no parent yet. A child
 * id may name no node (a dangling child): it is never a group member.
 *
 * There is no `delete`: a plan only adds nodes or moves them, and
 * `node.delete` plans nothing over a graph — it hands its ids to the commit.
 *
 * Nothing a reader is handed can change the graph: a node is the graph's
 * copy, and a group is a read-only view.
 *
 * Two implementations meet this one contract (`node-graph.contract.test.ts`
 * runs the same properties over both): {@link ScannedNodes} answers every
 * question by scanning an array, as the array forms (`resolveFieldId`,
 * `resolveTagId`, `siblingSlots`) do; {@link IndexedNodes} answers from
 * indexes kept current as it is written, so a plan that adds many nodes pays
 * for them once.
 */
export interface NodeGraph extends NamedNodes, SiblingGroups<KbNode> {
  get(id: NodeId): KbNode | undefined;
  has(id: NodeId): boolean;
  typedNamed(typeId: NodeId, text: string): readonly KbNode[];
  parentOf(id: NodeId): NodeId | undefined;
  slots(parent: NodeId | null, excluding?: NodeId): Slots<KbNode>;
  /** Every node, in no promised order. */
  values(): Iterable<KbNode>;
  put(node: KbNode): void;
  /**
   * File `child` under `parent` at `position` (the end when omitted or past
   * it), the parent stamped `at`. `parent` is a node of the graph; `child`
   * has no parent and need not be put yet.
   */
  insertChild(parent: NodeId, child: NodeId, position: number | undefined, at: string): void;
}

const hasType = (node: KbNode, typeId: NodeId): boolean => typeRefsOf(node).includes(typeId);

/** `list` with `child` at `position`, or at the end when it is omitted or past it. */
function withChild(list: readonly NodeId[], child: NodeId, position: number | undefined): NodeId[] {
  const at = position === undefined || position > list.length ? list.length : position;
  return [...list.slice(0, at), child, ...list.slice(at)];
}

/** {@link NodeGraph} by scanning an array: every answer reads the whole set. */
export class ScannedNodes implements NodeGraph {
  #nodes: readonly KbNode[];

  /** Reads `nodes` as given; a write writes a copy, so the caller's array is never written. */
  constructor(nodes: readonly KbNode[]) {
    this.#nodes = nodes;
  }

  get(id: NodeId): KbNode | undefined {
    return this.#nodes.find((n) => n.id === id);
  }

  has(id: NodeId): boolean {
    return this.get(id) !== undefined;
  }

  typedNamed(typeId: NodeId, text: string): KbNode[] {
    return this.#nodes.filter((n) => n.text === text && hasType(n, typeId));
  }

  parentOf(id: NodeId): NodeId | undefined {
    return this.#nodes.find((n) => n.children.includes(id))?.id;
  }

  slots(parent: NodeId | null, excluding?: NodeId): Slots<KbNode> {
    return siblingSlots(this.#nodes, parent, excluding);
  }

  values(): Iterable<KbNode> {
    return this.#nodes;
  }

  put(node: KbNode): void {
    const at = this.#nodes.findIndex((n) => n.id === node.id);
    this.#nodes = at < 0 ? [...this.#nodes, node] : this.#nodes.with(at, node);
  }

  insertChild(parent: NodeId, child: NodeId, position: number | undefined, at: string): void {
    const node = this.get(parent);
    if (node === undefined) return;
    this.put({ ...node, children: withChild(node.children, child, position), updatedAt: at });
  }
}

const nameKey = (typeId: NodeId, text: string): string => `${typeId}\u0000${text}`;

/** The index at which `node` sits, or would be inserted, in `sorted` (visible root order). */
function lowerBound(sorted: readonly KbNode[], node: KbNode): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const at = sorted[mid];
    if (at !== undefined && compareRootOrder(at, node) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * {@link NodeGraph} from indexes kept current as it is written: by id, by
 * type and text, by parent, each node's own working list of children, the
 * count of a parent's dangling children, and the roots — put in visible
 * order the first time they are asked for, and kept in it after.
 *
 * What a plan pays, per node it adds: filing it under a parent appends to
 * that parent's list (amortised O(1); a position mid-list moves the rest),
 * and reading a neighbour's rank reads one slot of a view. A parent's node
 * is rebuilt with its children once, when it is next read, not once per
 * child. Placing a node at the forest roots costs a binary search and one
 * array insertion, which moves the roots after it — O(R) in memory moves,
 * the one cost left that grows with the store.
 */
export class IndexedNodes implements NodeGraph {
  /** Each node as last put; its `children` lag {@link #children} while it is in {@link #stale}. */
  readonly #byId = new Map<NodeId, KbNode>();
  /** Each node's own children list, written in place by `insertChild`. */
  readonly #children = new Map<NodeId, NodeId[]>();
  /** Nodes whose children grew since they were stored, with the stamp of the last growth. */
  readonly #stale = new Map<NodeId, string>();
  readonly #named = new Map<string, Set<NodeId>>();
  readonly #parentOf = new Map<NodeId, NodeId>();
  /** For each parent, how many of its children name no node. */
  readonly #dangling = new Map<NodeId, number>();
  readonly #rootIds = new Set<NodeId>();
  /** The roots in visible order, once asked for; kept in order by every write after that. */
  #ordered: KbNode[] | null = null;

  static of(nodes: Iterable<KbNode>): IndexedNodes {
    const graph = new IndexedNodes();
    for (const node of nodes) graph.put(node);
    return graph;
  }

  get(id: NodeId): KbNode | undefined {
    const node = this.#byId.get(id);
    const at = this.#stale.get(id);
    if (node === undefined || at === undefined) return node;
    const fresh = { ...node, children: [...(this.#children.get(id) ?? [])], updatedAt: at };
    this.#byId.set(id, fresh);
    this.#stale.delete(id);
    return fresh;
  }

  has(id: NodeId): boolean {
    return this.#byId.has(id);
  }

  typedNamed(typeId: NodeId, text: string): KbNode[] {
    const ids = this.#named.get(nameKey(typeId, text)) ?? [];
    return [...ids].flatMap((id) => this.get(id) ?? []);
  }

  parentOf(id: NodeId): NodeId | undefined {
    return this.#parentOf.get(id);
  }

  slots(parent: NodeId | null, excluding?: NodeId): Slots<KbNode> {
    const member = excluding !== undefined && this.has(excluding) ? excluding : undefined;
    const excluded = member !== undefined && this.#parentOf.get(member) === (parent ?? undefined);
    if (parent === null) {
      this.#ordered ??= [...this.#rootIds]
        .flatMap((id) => this.#byId.get(id) ?? [])
        .toSorted(compareRootOrder);
      const roots = this.#ordered;
      if (excluded) {
        return roots.flatMap((n) => (n.id === member ? [] : (this.get(n.id) ?? [])));
      }
      return { length: roots.length, at: (i) => this.#viewed(roots[i]?.id) };
    }
    const ids = this.#children.get(parent) ?? [];
    if (excluded || (this.#dangling.get(parent) ?? 0) > 0) {
      return ids.flatMap((id) => (id === member ? [] : (this.get(id) ?? [])));
    }
    return { length: ids.length, at: (i) => this.#viewed(ids[i]) };
  }

  values(): Iterable<KbNode> {
    return [...this.#byId.keys()].flatMap((id) => this.get(id) ?? []);
  }

  put(node: KbNode): void {
    const old = this.#byId.get(node.id);
    this.#unroot(node.id);
    if (old !== undefined) {
      for (const typeId of typeRefsOf(old)) {
        this.#named.get(nameKey(typeId, old.text))?.delete(old.id);
      }
      const kept = new Set(node.children);
      for (const child of this.#children.get(node.id) ?? []) {
        if (kept.has(child) || this.#parentOf.get(child) !== node.id) continue;
        this.#parentOf.delete(child);
        this.#root(child);
      }
    } else {
      // A child some parent already named now names a node.
      const parent = this.#parentOf.get(node.id);
      if (parent !== undefined) this.#addDangling(parent, -1);
    }
    this.#byId.set(node.id, node);
    this.#stale.delete(node.id);
    this.#children.set(node.id, [...node.children]);
    for (const typeId of typeRefsOf(node)) {
      const key = nameKey(typeId, node.text);
      const ids = this.#named.get(key) ?? new Set<NodeId>();
      ids.add(node.id);
      this.#named.set(key, ids);
    }
    let dangling = 0;
    for (const child of node.children) {
      if (!this.#byId.has(child)) dangling++;
      this.#unroot(child);
      this.#parentOf.set(child, node.id);
    }
    this.#dangling.set(node.id, dangling);
    if (!this.#parentOf.has(node.id)) this.#root(node.id);
  }

  insertChild(parent: NodeId, child: NodeId, position: number | undefined, at: string): void {
    const list = this.#children.get(parent);
    if (list === undefined) return;
    if (position === undefined || position >= list.length) list.push(child);
    else list.splice(Math.max(0, position), 0, child);
    this.#stale.set(parent, at);
    this.#unroot(child);
    this.#parentOf.set(child, parent);
    if (!this.#byId.has(child)) this.#addDangling(parent, 1);
  }

  /** A group member as a reader sees it: the node with its current children. */
  #viewed(id: NodeId | undefined): KbNode | undefined {
    return id === undefined ? undefined : this.get(id);
  }

  #addDangling(parent: NodeId, delta: number): void {
    this.#dangling.set(parent, (this.#dangling.get(parent) ?? 0) + delta);
  }

  /** Make `id` a root, if it is a stored node, in its place in the visible order. */
  #root(id: NodeId): void {
    const node = this.#byId.get(id);
    if (node === undefined || this.#rootIds.has(id)) return;
    this.#rootIds.add(id);
    // The insertion moves every root after it: O(R) per top-level placement.
    // GAP [[01M52RTGASH2F5PVW7CK2Q50VN]]
    if (this.#ordered !== null) this.#ordered.splice(lowerBound(this.#ordered, node), 0, node);
  }

  /** Take `id` out of the roots, finding it by the version the order holds. */
  #unroot(id: NodeId): void {
    if (!this.#rootIds.delete(id)) return;
    const node = this.#byId.get(id);
    if (this.#ordered === null || node === undefined) return;
    const at = lowerBound(this.#ordered, node);
    if (this.#ordered[at]?.id === id) this.#ordered.splice(at, 1);
  }
}
