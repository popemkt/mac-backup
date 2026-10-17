/**
 * What a canvas reads of the kb around it (DESIGN.md → Canvas documents):
 * the nodes its items stand for and lead to, and the canvases their links
 * name. Its lints and its description read kb
 * only through a {@link CanvasWorld}, and both hosts build theirs from the
 * nodes they hold with {@link canvasWorld}, so a lint or a description
 * cannot read kb one way on the server and another in the page.
 */
import { typeRefsOf, type KbNode, type NodeId } from "@kb/model";
import { EMPTY_CANVAS_DOC, parseCanvasDoc, type CanvasDoc } from "./doc.ts";
import { CANVAS_IDS } from "./ids.ts";

export interface CanvasWorld {
  /** A node's text; undefined when the store does not hold it. */
  readonly textOf: (id: NodeId) => string | undefined;
  /**
   * A canvas's document: an empty one for a canvas that holds none kb can
   * read; undefined for a node that is no canvas, or is not there.
   */
  readonly docOf: (id: NodeId) => CanvasDoc | undefined;
}

/** What {@link canvasWorld} reads of a node: a store's `KbNode` and the page's outline node alike. */
export type WorldNode = Pick<KbNode, "id" | "text" | "props">;

/** The world `nodes` make; of two with one id, the later. */
export function canvasWorld(nodes: Iterable<WorldNode>): CanvasWorld {
  const byId = new Map<NodeId, WorldNode>();
  for (const node of nodes) byId.set(node.id, node);
  const docs = new Map<NodeId, CanvasDoc | undefined>();
  const docOf = (id: NodeId): CanvasDoc | undefined => {
    if (!docs.has(id)) docs.set(id, readDoc(byId.get(id)));
    return docs.get(id);
  };
  return { textOf: (id) => byId.get(id)?.text, docOf };
}

/** `node`'s document, when it is a canvas (`docOf`). */
function readDoc(node: WorldNode | undefined): CanvasDoc | undefined {
  if (node === undefined || !typeRefsOf(node).includes(CANVAS_IDS.canvasTag)) return undefined;
  const raw = node.props[CANVAS_IDS.canvasField]?.[0];
  if (raw?.t !== "str") return EMPTY_CANVAS_DOC;
  try {
    return parseCanvasDoc(raw.v);
  } catch {
    return EMPTY_CANVAS_DOC;
  }
}
