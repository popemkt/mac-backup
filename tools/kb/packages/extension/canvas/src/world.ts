/**
 * What a canvas reads of the kb around it (DESIGN.md → Canvas documents):
 * the nodes its items stand for. Its lints and its description read kb
 * only through a {@link CanvasWorld}, and both hosts build theirs from the
 * nodes they hold with {@link canvasWorld}, so a lint or a description
 * cannot read kb one way on the server and another in the page.
 */
import type { KbNode, NodeId } from "@kb/model";

export interface CanvasWorld {
  /** A node's text; undefined when the store does not hold it. */
  readonly textOf: (id: NodeId) => string | undefined;
}

/** What {@link canvasWorld} reads of a node: a store's `KbNode` and the page's outline node alike. */
export type WorldNode = Pick<KbNode, "id" | "text">;

/** The world `nodes` make; of two with one id, the later. */
export function canvasWorld(nodes: Iterable<WorldNode>): CanvasWorld {
  const texts = new Map<NodeId, string>();
  for (const node of nodes) texts.set(node.id, node.text);
  return { textOf: (id) => texts.get(id) };
}
