/**
 * Promote to node (plan 2026-10-02, decision 3): an item's meaning moves
 * from its own words into a node. The node is made from the item's text by
 * the caller (with no parent, per D6), and the item then shows it: a text
 * card becomes a card (`kb-node`) of that node, its own words dropped,
 * everything else about it — its box, turn, colour, frame and facing —
 * kept. Nothing becomes a node unless someone promotes it, which is the
 * owner's deferral of items-as-nodes (plan step 7b) kept.
 */
import { isTextNode, type CanvasDoc, type CanvasKbNode } from "./doc.ts";
import { CanvasRelationError } from "./relations.ts";

/**
 * The words item `id` of `doc` would give its node, or a relation error
 * saying why it cannot be promoted: it is not a text card (a shape shows
 * its label, never a node, until shapes show nodes), it already stands for
 * a node, or it says nothing.
 */
// A shape shows its label, not a node, so promoting one would hide its
// words; only text cards promote.
// GAP [promote-shapes]
export function promotableText(doc: CanvasDoc, id: string): string {
  const item = doc.nodes.find((node) => node.id === id);
  if (item === undefined) throw new CanvasRelationError(`no item ${id} on this canvas`);
  if (item.nodeId !== undefined) {
    throw new CanvasRelationError(`${id} already stands for node ${item.nodeId}`);
  }
  if (!isTextNode(item)) {
    throw new CanvasRelationError(
      `${id} is a ${item.type}; only a text card is promoted to a node`,
    );
  }
  if (item.text.trim() === "")
    throw new CanvasRelationError(`${id} says nothing to make a node of`);
  return item.text;
}

/** `doc` with text item `id` showing node `nodeId` as a card, its own words dropped. */
export function promoteItem(doc: CanvasDoc, id: string, nodeId: string): CanvasDoc {
  promotableText(doc, id);
  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      if (node.id !== id || !isTextNode(node)) return node;
      const { text: _words, type: _type, ...rest } = node;
      const card: CanvasKbNode = { ...rest, type: "kb-node", nodeId };
      return card;
    }),
  };
}
