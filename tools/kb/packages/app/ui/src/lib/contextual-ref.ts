/**
 * Contextual references (Tana "contextual content").
 *
 * A contextual reference is an ordinary node carrying its target on the
 * `sys.f.ref.target` ref field — the same anatomy as a query node
 * (`sys.f.query`). The field is the whole declaration: strip it and the node is
 * not a reference, it is a plain node, so there is no `#ref` supertag to carry
 * the same distinction twice (DESIGN.md → Kinds, roles and options). It
 * displays the *target's* text; its
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
 *   literally and the whole row went link-coloured. The dashed bullet ring is
 *   what marks the row as a reference.
 *
 *   Note what a ref *prop* buys over typing `[[id|label]]` by hand: the label
 *   in a hand-written token freezes at insert time, while this resolves on every
 *   render.
 * - **The row shows, edits and opens its target; its structure is its own.**
 *   `shownNodeId` names the node whose text the row renders and writes, and
 *   whose page the row's zoom gesture opens. Everything structural — the row's
 *   place, its children, collapse, tags, selection, instance key, indent,
 *   moves and delete — stays on the reference node, so the one row↔node
 *   identity every keymap, optimistic mutation and undo entry is built on is
 *   not forked: only the text channel is routed. Clicking the text edits the
 *   original in place (Tana's behaviour); deleting the row deletes the
 *   reference, never the original.
 */
import { schemaOf, type SchemaIndex, type SchemaSource } from "@/lib/schema";
import type { OutlineNode } from "@/lib/types";
import { SYSTEM_IDS, isSysPrefixed } from "@/lib/types";

/**
 * The node this reference points at, or null when it is not a reference.
 *
 * One read of one carrier. The tag check that used to guard this was the second
 * carrier for one distinction — and a strictly weaker one, since a `#ref` node
 * with no target is not a reference either, so the field already answered for
 * both. "Is it named `ref`?" was never on the table: a user tag called `ref`
 * must not turn its rows into references, and now it cannot, because nothing
 * reads a tag name here at all.
 */
export function contextualTargetOf(node: OutlineNode | undefined): string | null {
  const value = (node?.props[SYSTEM_IDS.refTargetField] ?? []).find(
    (v) => v.t === "ref" && typeof v.v === "string" && v.v !== "",
  );
  return value ? String(value.v) : null;
}

export function isContextualRef(node: OutlineNode | undefined): boolean {
  return contextualTargetOf(node) !== null;
}

/**
 * The node a row shows: its target for a contextual reference, itself for
 * every other row. The row's text is this node's text — rendered, edited and
 * zoomed into here — while the row's structure stays the row's own.
 */
export function shownNodeId(node: OutlineNode): string {
  return contextualTargetOf(node) ?? node.id;
}

/**
 * The node a row shows, as a node: the target of a contextual reference, the
 * row itself otherwise — and the row itself for a dangling reference, which
 * has nothing else to show.
 *
 * Read from the schema, the whole graph, so a reference to a node outside the
 * current scope still shows it.
 */
function shownNode(node: OutlineNode, schema: SchemaIndex): OutlineNode {
  const shownId = shownNodeId(node);
  return shownId === node.id ? node : (schema.get(shownId) ?? node);
}

/**
 * The markdown a row renders. Ordinary nodes render their own text; a
 * contextual reference renders its target's, resolved on every render.
 *
 * One function so the outline row and the References list cannot disagree —
 * a reference's own text is empty, and a list that read `node.text` directly
 * would show a blank row.
 */
export function rowText(node: OutlineNode, schema: SchemaIndex): string {
  const shownId = shownNodeId(node);
  // A dangling reference renders the way every other dangling ref in this app
  // renders — as the `[[id]]` token — rather than as a blank row.
  if (shownId !== node.id && schema.get(shownId) === undefined) return `[[${shownId}]]`;
  return shownNode(node, schema).text;
}

/**
 * A row's text and the node that text belongs to, by row id, from store
 * state — for the steps that act on a row they know only by id (a keymap
 * intent, a selection action). An unknown id reads as its own empty text.
 */
export function rowTextOf(
  state: SchemaSource,
  nodeId: string,
): { readonly text: string; readonly textNodeId: string } {
  const node = state.nodes.get(nodeId);
  if (!node) return { text: "", textNodeId: nodeId };
  return { text: rowText(node, schemaOf(state)), textNodeId: shownNodeId(node) };
}

/**
 * Why a row's text cannot be edited, or null when it can — the single owner
 * of that rule, and of the wording the padlock shows.
 *
 * The rule is about the node whose text is on screen (`shownNodeId`): a
 * `sys.*` node is read-only at the door (r1 D20), whether the row is that node
 * or a reference to it, and a reference whose target is gone has no text to
 * write to. Returning the reason rather than a bare boolean keeps the tooltip
 * from re-deriving the distinction at the call site.
 */
export function rowTextReadOnlyReason(
  id: string,
  node: OutlineNode | undefined,
  schema: SchemaIndex,
): string | null {
  const shownId = node ? shownNodeId(node) : id;
  if (isSysPrefixed(id) || isSysPrefixed(shownId)) return "System node — read-only";
  if (shownId !== id && schema.get(shownId) === undefined) return "Reference target is missing";
  return null;
}
