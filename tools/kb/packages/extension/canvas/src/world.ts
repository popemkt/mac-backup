/**
 * What a canvas reads of the kb around it (DESIGN.md → Canvas documents):
 * the nodes its items stand for and lead to, the canvases their links
 * name, the outline round it, where its pages are (`./pages.ts`), the
 * comment threads on it (`./comments.ts`), and how its view node looks at
 * it (`./camera.ts`). Its lints and its description read kb
 * only through a {@link CanvasWorld}, and both hosts build theirs from the
 * nodes they hold with {@link canvasWorld}, so a lint or a description
 * cannot read kb one way on the server and another in the page.
 */
import { typeRefsOf, type KbNode, type NodeId } from "@kb/model";
import { readCanvasCamera, type CanvasCamera } from "./camera.ts";
import { threadsByCanvas, type CanvasThread } from "./comments.ts";
import { EMPTY_CANVAS_DOC, parseCanvasDoc, type CanvasDoc } from "./doc.ts";
import { CANVAS_IDS } from "./ids.ts";
import { canvasViewIdOf } from "./view.ts";

export interface CanvasWorld {
  /** A node's text; undefined when the store does not hold it. */
  readonly textOf: (id: NodeId) => string | undefined;
  /**
   * A canvas's document: an empty one for a canvas that holds none kb can
   * read; undefined for a node that is no canvas, or is not there.
   */
  readonly docOf: (id: NodeId) => CanvasDoc | undefined;
  /** The node a node is a child of; undefined for a root, or a node not there. */
  readonly parentOf: (id: NodeId) => NodeId | undefined;
  /** A node's children, in their order. */
  readonly childrenOf: (id: NodeId) => readonly NodeId[];
  /** The comment threads on a canvas, in the order their first comments come. */
  readonly threadsOn: (canvas: NodeId) => readonly CanvasThread[];
  /** How a canvas is looked at: its canvas view node's camera (`canvasViewIdOf`), if it holds one. */
  readonly cameraOf: (canvas: NodeId) => CanvasCamera | undefined;
}

/** What {@link canvasWorld} reads of a node: a store's `KbNode` and the page's outline node alike. */
export type WorldNode = Pick<KbNode, "id" | "text" | "props" | "children">;

/** The world `nodes` make; of two with one id, the later. */
export function canvasWorld(nodes: Iterable<WorldNode>): CanvasWorld {
  const byId = new Map<NodeId, WorldNode>();
  for (const node of nodes) byId.set(node.id, node);
  const parents = new Map<NodeId, NodeId>();
  for (const node of byId.values()) for (const child of node.children) parents.set(child, node.id);
  const docs = new Map<NodeId, CanvasDoc | undefined>();
  const docOf = (id: NodeId): CanvasDoc | undefined => {
    if (!docs.has(id)) docs.set(id, readDoc(byId.get(id)));
    return docs.get(id);
  };
  let threads: Map<NodeId, CanvasThread[]> | undefined;
  return {
    textOf: (id) => byId.get(id)?.text,
    docOf,
    parentOf: (id) => parents.get(id),
    childrenOf: (id) => byId.get(id)?.children ?? [],
    threadsOn: (canvas) => {
      threads ??= threadsByCanvas(byId);
      return threads.get(canvas) ?? [];
    },
    cameraOf: (canvas) => {
      const view = canvasViewIdOf(byId.get(canvas), (id) => byId.get(id));
      const props = view === null ? undefined : byId.get(view)?.props;
      return props === undefined ? undefined : readCanvasCamera(props);
    },
  };
}

/**
 * Whether `node` is a canvas: tagged `#canvas`. The one statement of it —
 * the world, the canvas list and the write path all ask this.
 */
export function isCanvasNode(node: Pick<KbNode, "props">): boolean {
  return typeRefsOf(node).includes(CANVAS_IDS.canvasTag);
}

/** `node`'s document, when it is a canvas (`docOf`). */
function readDoc(node: WorldNode | undefined): CanvasDoc | undefined {
  if (node === undefined || !isCanvasNode(node)) return undefined;
  const raw = node.props[CANVAS_IDS.canvasField]?.[0];
  if (raw?.t !== "str") return EMPTY_CANVAS_DOC;
  try {
    return parseCanvasDoc(raw.v);
  } catch {
    return EMPTY_CANVAS_DOC;
  }
}
