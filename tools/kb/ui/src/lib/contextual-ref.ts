/**
 * Contextual references (Tana "contextual content").
 *
 * A contextual reference is an ordinary node tagged `#ref` (sys.tag.ref)
 * carrying its target on the `sys.f.ref.target` ref field — the same anatomy as
 * a query node (`#query` + `sys.f.query`). It displays the *target's* text; its
 * own children are the local, contextual content and belong to this location,
 * not to the target. Nothing else about the row is special: children, tags,
 * fields, collapse state, instance keys and both keymaps are the ordinary ones.
 *
 * Two consequences worth stating, because they are what make it a node and not
 * a widget:
 *
 * - **Display is the target's text, verbatim.** `rowText` hands the *target's*
 *   markdown to the row, so it renders through exactly the path every other row
 *   uses — bold, code, inline refs and `assets/` media all render as content.
 *   Rendering it as a `[[id|label]]` token instead was tried and looked wrong:
 *   a ref label is terminal in the inline grammar, so `**markdown**` showed up
 *   literally and the whole row went link-coloured. The dashed bullet ring and
 *   the `#ref` chip are what mark the row as a reference.
 *
 *   Note what a ref *prop* buys over typing `[[id|label]]` by hand: the label
 *   in a hand-written token freezes at insert time, while this resolves on every
 *   render.
 * - **The row's own text is not editable, and "click here" is answered at the
 *   target.** The text is not the row's, so a caret in it would edit an
 *   invisible second string; `rowTextReadOnlyReason` is the single owner of that
 *   rule and absorbed the `sys.*` case that already had it. Rather than leaving
 *   the click dead, `NodeBlock` routes the same activate intent to the node that
 *   owns the text — clicking a reference opens the original, which is where
 *   every editing affordance already works. ⌘-click on the bullet still zooms
 *   the reference itself, so the two destinations have two affordances.
 */
import { typeRefsOf } from "@kb/ontology";
import type { NodeMap, OutlineNode } from "@/lib/types";
import { SYSTEM_IDS, isSysPrefixed } from "@/lib/types";

/**
 * The seeded `#ref` tag, matched by id only.
 *
 * Deliberately narrower than `isQueryTagBadges`, which also accepts any tag
 * *named* "query": "ref" is a common word, and a user tag that happens to be
 * called `ref` must not silently turn its rows into references.
 *
 * Read from the kind slot (`typeRefsOf`), never from `node.tags` — that list is
 * a DISPLAY list which drops kind refs, so membership read off it is only
 * accidentally right (see graph-view.resolveTags).
 */
function hasRefTag(node: OutlineNode): boolean {
  return typeRefsOf(node).includes(SYSTEM_IDS.refTag);
}

/** The node this reference points at, or null when it is not a reference. */
export function contextualTargetOf(
  node: OutlineNode | undefined,
): string | null {
  if (!node || !hasRefTag(node)) return null;
  const value = (node.props[SYSTEM_IDS.refTargetField] ?? []).find(
    (v) => v.t === "ref" && typeof v.v === "string" && v.v !== "",
  );
  return value ? String(value.v) : null;
}

export function isContextualRef(node: OutlineNode | undefined): boolean {
  return contextualTargetOf(node) !== null;
}

/**
 * The markdown a row renders. Ordinary nodes render their own text; a
 * contextual reference renders its target's, resolved on every render.
 *
 * One function so the outline row and the References list cannot disagree —
 * a reference's own text is empty, and a list that read `node.text` directly
 * would show a blank row.
 */
export function rowText(node: OutlineNode, nodes: NodeMap): string {
  const targetId = contextualTargetOf(node);
  if (!targetId) return node.text;
  const target = nodes.get(targetId);
  // A dangling reference renders the way every other dangling ref in this app
  // renders — as the `[[id]]` token — rather than as a blank row.
  return target ? target.text : `[[${targetId}]]`;
}

/**
 * Why a row's text is not the row's own to edit, or null when it is — the
 * single owner of that rule, and of the wording the padlock shows.
 *
 * `sys.*` rows are read-only at the door (r1 D20); a contextual reference is
 * read-only for the same underlying reason — the text on screen belongs to
 * another node. Returning the reason rather than a bare boolean is what keeps
 * the tooltip from re-deriving the distinction at the call site.
 */
export function rowTextReadOnlyReason(
  id: string,
  node: OutlineNode | undefined,
): string | null {
  if (isSysPrefixed(id)) return "System node — read-only";
  if (isContextualRef(node)) return "Reference — edit the original";
  return null;
}
