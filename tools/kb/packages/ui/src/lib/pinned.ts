/**
 * Pinned nodes — the sidebar's Pinned section, and the ⌘K pin toggle.
 *
 * "Pinned" is a tag, not a flag: a node is pinned when its kind slot names a
 * tag node whose text is exactly `pinned`. Nothing is seeded, so the tag costs
 * the graph nothing until the first pin mints it like any other user tag —
 * which is also why the lookup is by text and not by a `sys.tag.pinned` id.
 *
 * Membership comes from the prop through `typeRefsOf`, never from `node.tags`:
 * that list is a DISPLAY list (see `graph-view.resolveTags`, which drops kind
 * refs from it), and reading badge *names* back as truth is the anti-pattern
 * this module exists in order not to have.
 *
 * Not to be confused with an ontology's explicit pins
 * (`sys.f.onto.member` + the Unpin control on the ontology page): different
 * field, different mechanism, same English word. Nothing here touches those.
 */
import { typeRefsOf } from "@kb/model";
import { SYSTEM_IDS, type NodeMap, type OutlineNode } from "@/lib/types";

/** The tag text that means "pinned". Data, not an id — see the module note. */
export const PINNED_TAG_TEXT = "pinned";

/** Is this node the `pinned` supertag itself? */
function isPinnedTagNode(node: OutlineNode | undefined): boolean {
  if (!node || node.text !== PINNED_TAG_TEXT) return false;
  return typeRefsOf(node).includes(SYSTEM_IDS.tag);
}

/**
 * The id of the `pinned` tag, or null when nobody has pinned anything yet.
 * Lowest id wins so two same-named tags cannot make the toggle flap.
 */
export function findPinnedTagId(nodes: NodeMap): string | null {
  let found: string | null = null;
  for (const n of nodes.values()) {
    if (!isPinnedTagNode(n)) continue;
    if (found === null || n.id < found) found = n.id;
  }
  return found;
}

/**
 * The `pinned` tag ids this node actually carries, in stored order.
 *
 * Plural because "a tag whose text is `pinned`" is not unique — a user can mint
 * a second one. Unpinning has to remove the ones the node carries, not the one
 * a graph-wide scan happened to pick first.
 */
export function pinnedTagIdsOn(node: OutlineNode | undefined, nodes: NodeMap): string[] {
  return typeRefsOf(node).filter((id) => isPinnedTagNode(nodes.get(id)));
}

export function isPinned(node: OutlineNode | undefined, nodes: NodeMap): boolean {
  return pinnedTagIdsOn(node, nodes).length > 0;
}

/** Pinned nodes, ordered by label then id (stable sidebar order). */
export function listPinnedNodes(nodes: NodeMap): OutlineNode[] {
  return [...nodes.values()]
    .filter((n) => isPinned(n, nodes))
    .sort((a, b) => (a.text || a.id).localeCompare(b.text || b.id) || a.id.localeCompare(b.id));
}
