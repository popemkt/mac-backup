import type { KbNode, NodeId } from "./model.ts";
import { typeRefsOf } from "./ontology.ts";
import { compareRootOrder, type SiblingGroups } from "./order.ts";
import type { NamedNodes } from "./resolve.ts";

/**
 * A node set a write plan reads and writes into: a node by id, the nodes of
 * a type by text (name resolution, {@link NamedNodes}), each node's parent
 * and the forest roots in visible order (sibling groups, `SiblingGroups`),
 * kept current as the plan `put`s its upserts in. `put` replaces a node
 * whole, as a store upsert does.
 *
 * **Precondition: the set is a forest after every `put`** — no node is a
 * child of two nodes. A move therefore puts the old parent (child removed)
 * before the new one (child added), which is the order `node.update` emits
 * them in. While a node is listed by two parents, `parentOf` names the one
 * put last.
 *
 * There is no `delete`: a plan only adds nodes or moves them, and
 * `node.delete` plans nothing over a graph — it hands its ids to the commit.
 *
 * Two implementations meet this one contract (`node-graph.contract.test.ts`
 * runs the same properties over both): {@link ScannedNodes} answers every
 * question by scanning an array, which is what the array forms
 * (`resolveFieldId`, `resolveTagId`, and `siblingSlots` through
 * `groupSlots`) read; {@link IndexedNodes} answers
 * from indexes kept current on `put`, so a plan that adds many nodes pays
 * for them once.
 */
export interface NodeGraph extends NamedNodes, SiblingGroups<KbNode> {
  get(id: NodeId): KbNode | undefined;
  typedNamed(typeId: NodeId, text: string): readonly KbNode[];
  parentOf(id: NodeId): NodeId | undefined;
  /** The forest roots, in visible order (`compareRootOrder`). */
  roots(): readonly KbNode[];
  /** Every node, in no promised order. */
  values(): Iterable<KbNode>;
  put(node: KbNode): void;
}

const hasType = (node: KbNode, typeId: NodeId): boolean => typeRefsOf(node).includes(typeId);

/** {@link NodeGraph} by scanning an array: every answer reads the whole set. */
export class ScannedNodes implements NodeGraph {
  #nodes: readonly KbNode[];

  /** Reads `nodes` as given; a `put` writes a copy, so the caller's array is never written. */
  constructor(nodes: readonly KbNode[]) {
    this.#nodes = nodes;
  }

  get(id: NodeId): KbNode | undefined {
    return this.#nodes.find((n) => n.id === id);
  }

  typedNamed(typeId: NodeId, text: string): KbNode[] {
    return this.#nodes.filter((n) => n.text === text && hasType(n, typeId));
  }

  parentOf(id: NodeId): NodeId | undefined {
    return this.#nodes.find((n) => n.children.includes(id))?.id;
  }

  roots(): KbNode[] {
    const children = new Set(this.#nodes.flatMap((n) => n.children));
    return this.#nodes.filter((n) => !children.has(n.id)).toSorted(compareRootOrder);
  }

  values(): Iterable<KbNode> {
    return this.#nodes;
  }

  put(node: KbNode): void {
    const at = this.#nodes.findIndex((n) => n.id === node.id);
    this.#nodes = at < 0 ? [...this.#nodes, node] : this.#nodes.with(at, node);
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
 * {@link NodeGraph} from indexes kept current on `put`: by id, by type and
 * text, by parent, and the roots. The roots are put in visible order the
 * first time they are asked for, and kept in it after, so a plan that places
 * many top-level nodes pays a binary search per placement, never a sort.
 */
export class IndexedNodes implements NodeGraph {
  readonly #byId = new Map<NodeId, KbNode>();
  readonly #named = new Map<string, Set<NodeId>>();
  readonly #parentOf = new Map<NodeId, NodeId>();
  readonly #rootIds = new Set<NodeId>();
  /** The roots in visible order, once asked for; kept in order by `put` after that. */
  #ordered: KbNode[] | null = null;

  static of(nodes: Iterable<KbNode>): IndexedNodes {
    const graph = new IndexedNodes();
    for (const node of nodes) graph.put(node);
    return graph;
  }

  get(id: NodeId): KbNode | undefined {
    return this.#byId.get(id);
  }

  typedNamed(typeId: NodeId, text: string): KbNode[] {
    const ids = this.#named.get(nameKey(typeId, text)) ?? [];
    return [...ids].flatMap((id) => this.#byId.get(id) ?? []);
  }

  parentOf(id: NodeId): NodeId | undefined {
    return this.#parentOf.get(id);
  }

  roots(): readonly KbNode[] {
    this.#ordered ??= [...this.#rootIds]
      .flatMap((id) => this.#byId.get(id) ?? [])
      .toSorted(compareRootOrder);
    return this.#ordered;
  }

  values(): Iterable<KbNode> {
    return this.#byId.values();
  }

  put(node: KbNode): void {
    const old = this.#byId.get(node.id);
    this.#unroot(node.id);
    if (old !== undefined) {
      for (const typeId of typeRefsOf(old)) {
        this.#named.get(nameKey(typeId, old.text))?.delete(old.id);
      }
      const kept = new Set(node.children);
      for (const child of old.children) {
        if (kept.has(child) || this.#parentOf.get(child) !== node.id) continue;
        this.#parentOf.delete(child);
        this.#root(child);
      }
    }
    this.#byId.set(node.id, node);
    for (const typeId of typeRefsOf(node)) {
      const key = nameKey(typeId, node.text);
      const ids = this.#named.get(key) ?? new Set<NodeId>();
      ids.add(node.id);
      this.#named.set(key, ids);
    }
    for (const child of node.children) {
      this.#unroot(child);
      this.#parentOf.set(child, node.id);
    }
    if (!this.#parentOf.has(node.id)) this.#root(node.id);
  }

  /** Make `id` a root, if it is a stored node, in its place in the visible order. */
  #root(id: NodeId): void {
    const node = this.#byId.get(id);
    if (node === undefined || this.#rootIds.has(id)) return;
    this.#rootIds.add(id);
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
