import type Graph from "graphology";

/**
 * A node's stored position. graphology types attributes as an open record, so
 * every renderer used to assert the shape at the point of use; this is the one
 * place that says what "where is this node" means.
 */
export function nodePosition(graph: Graph, node: string): { x: number; y: number } {
  const { x, y } = graph.getNodeAttributes(node);
  return { x: Number(x), y: Number(y) };
}
