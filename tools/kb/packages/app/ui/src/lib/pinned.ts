/**
 * Pinned nodes — the sidebar's Pinned section, and the ⌘K pin toggle.
 *
 * **Pinned is a list, not a mark.** The seeded `pinned` node's children are
 * contextual references (`sys.f.ref.target`) to the pinned nodes, and that list
 * *is* the section. Pin = add a child; unpin = remove it.
 *
 * This replaces a `pinned` supertag, and the reasons it replaces it are the
 * three things a tag could not give:
 *
 * - **Order is data.** A tag is a set; the sidebar had to invent an order and
 *   sorted by label, so "put my inbox at the top" was not expressible. Children
 *   are ordered, and the outline's existing drag-reorder writes that order —
 *   nothing in the sidebar had to learn about dragging.
 * - **One node kind, reused.** A pin is an ordinary contextual reference, the
 *   same node the outline already renders, backlinks already count, and ⌘K
 *   already mints. A tag would have been a second way to say "this node is
 *   mentioned over there".
 * - **Nothing is written to the pinned node.** A tag edits the node's kind slot,
 *   which is why the toggle used to refuse `sys.*` targets — pinning
 *   `sys.queries` was a *write* to it. Pointing at a node is not a write, so
 *   that restriction is gone with the mechanism that caused it.
 *
 * The old module argued the other way: a tag "costs the graph nothing until the
 * first pin mints it", and membership through `typeRefsOf` avoided reading badge
 * names back as truth. Both were true; neither was the question. The tag named
 * no concept — strip the tag and the node is unchanged, it is simply not in a
 * list any more — so `pinned` was sidebar membership wearing a supertag
 * (DESIGN.md → Kinds, roles and options). The seeded list node costs one row.
 *
 * Not to be confused with an ontology's explicit pins
 * (`sys.f.onto.member` + the Unpin control on the ontology page): different
 * field, different mechanism, same English word. Nothing here touches those.
 */
import { contextualTargetOf } from "@/lib/contextual-ref";
import { SYSTEM_IDS, type NodeMap, type OutlineNode } from "@/lib/types";

/** Child ids of the Pinned list, in stored order. Empty when it is unseeded. */
export function pinnedRefIds(nodes: NodeMap): string[] {
  return nodes.get(SYSTEM_IDS.pinnedRoot)?.children ?? [];
}

/**
 * The reference rows that pin `targetId`, in list order.
 *
 * Plural because nothing forbids pinning the same node twice — two rows is a
 * state the outline can reach directly — and unpinning has to clear all of
 * them, not the first one a scan happened to find.
 */
export function pinnedRefIdsFor(nodes: NodeMap, targetId: string): string[] {
  return pinnedRefIds(nodes).filter((id) => contextualTargetOf(nodes.get(id)) === targetId);
}

export function isPinned(nodes: NodeMap, targetId: string): boolean {
  return pinnedRefIdsFor(nodes, targetId).length > 0;
}

/**
 * The pinned nodes themselves, in list order.
 *
 * A reference whose target has been deleted is dropped rather than rendered as
 * a dangling row: the sidebar is navigation, and a row that leads nowhere is
 * worse than a missing one. The reference node survives, so the outline still
 * shows it and the user can delete it there.
 */
export function listPinnedNodes(nodes: NodeMap): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const refId of pinnedRefIds(nodes)) {
    const targetId = contextualTargetOf(nodes.get(refId));
    const target = targetId === null ? undefined : nodes.get(targetId);
    if (target !== undefined) out.push(target);
  }
  return out;
}
