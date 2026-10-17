/**
 * What a canvas document points at (DESIGN.md → Canvas documents): the
 * node each card shows, the node each item's link leads to, and both ends
 * of each edge bound to a relation. The
 * family declares its document field as a carrier of the reference relation
 * with it (`refCarriers` in `./extension.ts`), so a node's References list
 * every canvas that shows it, as they list a node that names it in words.
 */
import type { NodeId, PropValue } from "@kb/model";
import { parseCanvasDoc, type CanvasDoc } from "./doc.ts";
import { itemLead } from "./links.ts";

/** The node ids `doc` points at, in document order, with repeats. */
function docReferences(doc: CanvasDoc): NodeId[] {
  return [
    ...doc.nodes.flatMap((item) => {
      const lead = itemLead(item);
      return [
        ...(item.nodeId === undefined ? [] : [item.nodeId]),
        ...(lead !== undefined && "node" in lead ? [lead.node] : []),
      ];
    }),
    ...doc.edges.flatMap((edge) =>
      edge.kbLink === undefined ? [] : [edge.kbLink.sourceNodeId, edge.kbLink.targetNodeId],
    ),
  ];
}

/** The node ids a value of the canvas field points at; none for a value that is no canvas. */
export function canvasReferences(value: PropValue): NodeId[] {
  if (value.t !== "str") return [];
  try {
    return docReferences(parseCanvasDoc(value.v));
  } catch {
    return [];
  }
}
