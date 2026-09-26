/**
 * History as invocations: the actions that take the graph from one state back
 * to another. Undo records these rather than a snapshot, so a restore is
 * written by the same actions every other edit is — actions remain the one
 * writer, and the server derives every rank a restore implies.
 */
import type { WireNode } from "@kb/contracts";
import { siblingSlots } from "@kb/model";
import { findParentWire } from "@/lib/tx";
import type { PropValue } from "@/lib/types";

function propEntries(node: WireNode): Array<{ field: string; value: PropValue }> {
  return Object.entries(node.props).flatMap(([field, values]) =>
    values.map((value) => ({ field, value })),
  );
}

/**
 * Where a node sits in `state`, as action input: its parent (null: a root) and
 * its index in that sibling group. Restoring by position is how history puts
 * a node back; the rank it implies is the server's to derive, like any other
 * placement.
 */
function placementIn(state: WireNode[], id: string): { parent: string | null; position: number } {
  const parent = findParentWire(state, id)?.id ?? null;
  return {
    parent,
    position: siblingSlots(state, parent).findIndex((node) => node.id === id),
  };
}

/** Each node's parent in a state: an id, or null for a forest root. */
function parentsIn(state: WireNode[]): Map<string, string | null> {
  const parents = new Map<string, string | null>(state.map((node) => [node.id, null]));
  for (const node of state) for (const child of node.children) parents.set(child, node.id);
  return parents;
}

/**
 * A node's place in `state`, as seen from `other`: its parent, and its index
 * among the siblings that share that parent in both states. Counting only the
 * shared siblings is what keeps a neighbour's move from reading as this
 * node's move.
 */
function placeKey(
  state: WireNode[],
  parents: Map<string, string | null>,
  otherParents: Map<string, string | null>,
  id: string,
): string {
  const parent = parents.get(id) ?? null;
  const shared = siblingSlots(state, parent).filter(
    (node) => otherParents.has(node.id) && otherParents.get(node.id) === parent,
  );
  return `${parent ?? ""}#${shared.findIndex((node) => node.id === id)}`;
}

/** Build inverse invocations from two graph states; actions remain the one writer. */
export function restoreInvocations(
  from: WireNode[],
  to: WireNode[],
): Array<{ id: string; input: unknown }> {
  const fromById = new Map(from.map((node) => [node.id, node]));
  const toById = new Map(to.map((node) => [node.id, node]));
  const actions: Array<{ id: string; input: unknown }> = [];
  for (const node of from) {
    if (!toById.has(node.id))
      actions.push({ id: "node.update", input: { id: node.id, delete: true } });
  }
  const missing = to.filter((node) => !fromById.has(node.id));
  const depth = (node: WireNode): number => {
    let count = 0;
    let parent = findParentWire(to, node.id);
    while (parent !== null) {
      count += 1;
      parent = findParentWire(to, parent.id);
    }
    return count;
  };
  // Shallowest first, and left to right within a group, so each position is
  // counted over siblings that are already back.
  const restoreOrder = missing
    .map((node) => ({ node, depth: depth(node), ...placementIn(to, node.id) }))
    .toSorted((a, b) => a.depth - b.depth || a.position - b.position);
  for (const { node, parent, position } of restoreOrder) {
    actions.push({
      id: "node.add",
      input: {
        id: node.id,
        text: node.text,
        props: propEntries(node),
        ...(parent !== null ? { parent } : {}),
        position,
      },
    });
  }
  const fromParents = parentsIn(from);
  const toParents = parentsIn(to);
  for (const target of to) {
    const current = fromById.get(target.id);
    if (!current) continue;
    // Content and place, not rank: a rank is how the store encodes a place,
    // and it may settle ranks on any commit, so a node whose only difference
    // is a rank the store rewrote has nothing for history to restore.
    const { order: _was, ...was } = current;
    const { order: _is, ...is } = target;
    const moved =
      placeKey(from, fromParents, toParents, target.id) !==
      placeKey(to, toParents, fromParents, target.id);
    if (!moved && JSON.stringify(was) === JSON.stringify(is)) continue;
    const unsetProps = Object.keys(current.props).map((field) => ({ field }));
    actions.push({
      id: "node.update",
      input: {
        id: target.id,
        text: target.text,
        ...(unsetProps.length > 0 ? { unsetProps } : {}),
        ...placementIn(to, target.id),
      },
    });
    const setProps = propEntries(target);
    if (setProps.length > 0) {
      actions.push({ id: "node.update", input: { id: target.id, setProps } });
    }
  }
  return actions;
}
