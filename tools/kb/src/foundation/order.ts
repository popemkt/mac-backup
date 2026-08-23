import type { KbNode, NodeId } from "./model.ts";

const WIDTH = 10;
const BASE = 36n;
const MAX = BASE ** BigInt(WIDTH) - 1n;

function encode(value: bigint): string {
  return value.toString(36).padStart(WIDTH, "0");
}

function decode(value: string): bigint {
  let result = 0n;
  for (const char of value.slice(0, WIDTH)) {
    const digit = parseInt(char, 36);
    if (Number.isNaN(digit)) return 0n;
    result = result * BASE + BigInt(digit);
  }
  return result;
}

/** Stable rank for an existing sibling list; it deliberately preserves order. */
export function ranksFor(ids: readonly NodeId[]): Map<NodeId, string> {
  const ranks = new Map<NodeId, string>();
  const step = MAX / BigInt(ids.length + 1);
  ids.forEach((id, index) => ranks.set(id, encode(step * BigInt(index + 1))));
  return ranks;
}

export function rankBetween(before?: string, after?: string): string {
  const low = before ? decode(before) : 0n;
  const high = after ? decode(after) : MAX;
  if (high - low > 1n) return encode((low + high) / 2n);
  // Exhausting a rank gap is exceptionally rare at this width. Appending a
  // sortable suffix avoids moving existing siblings; a later maintenance pass
  // may compact ranks without changing their visible sequence.
  return `${before ?? encode(0n)}h`;
}

/** One-time additive migration: assign ranks in today's visible child/root order. */
export function migrateOrderKeys(nodes: KbNode[]): { nodes: KbNode[]; changed: boolean } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const orderedGroups: NodeId[][] = [];
  const children = new Set<NodeId>();
  for (const node of nodes) {
    orderedGroups.push(node.children.filter((id) => byId.has(id)));
    node.children.forEach((id) => children.add(id));
  }
  // Legacy forest roots were id-sorted by the projection; use precisely that
  // sequence for migration so loading old JSONL cannot visibly reorder it.
  orderedGroups.push(nodes.filter((node) => !children.has(node.id)).map((node) => node.id).sort());
  const ranks = new Map<NodeId, string>();
  for (const ids of orderedGroups) for (const [id, rank] of ranksFor(ids)) ranks.set(id, rank);
  let changed = false;
  const migrated = nodes.map((node) => {
    const order = ranks.get(node.id);
    if (!order || node.order === order) return node;
    changed = true;
    return { ...node, order };
  });
  return { nodes: migrated, changed };
}
