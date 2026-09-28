/**
 * Contextual references: a node shown at a second place (Tana's reference).
 *
 * A contextual reference is an ordinary node carrying its target on the
 * `sys.f.ref.target` ref field — the same anatomy as a query node
 * (`sys.f.query`). The field is the whole declaration: strip it and the node is
 * not a reference, it is a plain node, so there is no `#ref` supertag to carry
 * the same distinction twice (DESIGN.md → Kinds, roles and options).
 *
 * **The row shows its target; its place is its own.** `shownNode` is the one
 * answer to "which node does this row show", and every content read of a row
 * goes through it: the text, the tag chips, the bullet's paint, the field
 * rows, the children and query results under it, its view, and the page its
 * zoom opens. So a reference row reads exactly like its target as an ordinary
 * row, and every write it makes — typing, a tag removed, a field value, a
 * child created under it — lands on the target, which is Tana's behaviour.
 * What stays on the reference node is its *place*: the parent edge, sibling
 * order, selection, instance key, collapse state, indent, moves and delete —
 * so the one row↔node identity every keymap, optimistic mutation and undo
 * entry is built on is not forked, and deleting the row deletes the
 * reference, never the original. The dashed bullet ring is the only thing
 * that marks the row as a reference.
 *
 * Display is the target's text, verbatim: `rowText` hands the *target's*
 * markdown to the row, so it renders through exactly the path every other row
 * uses. Rendering it as a `[[id|label]]` token instead was tried and looked
 * wrong: a ref label is terminal in the inline grammar, so `**markdown**`
 * showed up literally and the whole row went link-coloured. A ref *prop* also
 * buys what a hand-typed `[[id|label]]` cannot: the label resolves on every
 * render instead of freezing at insert time.
 *
 * Showing the target's children makes the outline a graph walk, not a tree
 * walk — a reference under its own target would expand into itself forever.
 * `showsAncestor` is the stop: a row whose shown node is already shown above
 * it on its instance path renders as a leaf.
 */
import { instanceAncestorIds } from "@/lib/instance-key";
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
export function shownNode(node: OutlineNode, schema: SchemaIndex): OutlineNode {
  const shownId = shownNodeId(node);
  return shownId === node.id ? node : (schema.get(shownId) ?? node);
}

/**
 * The row's shown node is already shown by a row above it on its instance
 * path (`tree/a/b/…`, `ref:query:<q>/…`), so expanding it would repeat that
 * row's rows inside themselves. Such a row is a leaf.
 */
export function showsAncestor(
  instanceKey: string,
  node: OutlineNode,
  schema: SchemaIndex,
): boolean {
  const shownId = shownNodeId(node);
  return instanceAncestorIds(instanceKey).some((id) => {
    const ancestor = schema.get(id);
    return ancestor !== undefined && shownNodeId(ancestor) === shownId;
  });
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
