/**
 * The 2D graphs' side of a node drag (`lib/graph-drag`): the surface is
 * sigma's camera — suspended while a press is down, and inverted to put the
 * node under the pointer — and a placed layout (radial, hierarchical, grid,
 * the cluster placement) only moves the node it holds. The force layout is
 * its own `DragLayout` (`fa2-layout`).
 */
import type Graph from "graphology";
import type Sigma from "sigma";
import type { DragLayout, DragSurface, LayoutPoint } from "@/lib/graph-drag";

/** Where node `id` stands in the layout now. */
export function graphPoint(graph: Graph, id: string): LayoutPoint {
  const x: unknown = graph.getNodeAttribute(id, "x");
  const y: unknown = graph.getNodeAttribute(id, "y");
  return { x: typeof x === "number" ? x : 0, y: typeof y === "number" ? y : 0 };
}

/** A layout with no forces: a held node stands where it is put, and nothing else moves. */
export function placedDrag(graph: Graph): DragLayout {
  const held = new Set<string>();
  return {
    grab: (id) => {
      if (graph.hasNode(id)) held.add(id);
    },
    hold: (id, at) => {
      if (held.has(id) && graph.hasNode(id)) graph.mergeNodeAttributes(id, { x: at.x, y: at.y });
    },
    drop: (id) => {
      held.delete(id);
    },
  };
}

/**
 * Sigma's camera as a drag surface: still while pressed, and the node kept
 * at its press offset. Sigma frames the graph by its extent, recomputed as
 * nodes move, so a node dragged outward would rescale the whole view under
 * the pointer; the frame is held at its extent from the grip to the release.
 */
export function sigmaDragSurface(sigma: Sigma): DragSurface {
  let framed = false;
  return {
    suspend: () => sigma.getCamera().disable(),
    resume: () => {
      sigma.getCamera().enable();
      if (framed) sigma.setCustomBBox(null);
      framed = false;
    },
    grip: (id, x, y) => {
      const graph = sigma.getGraph();
      if (!graph.hasNode(id)) return null;
      sigma.setCustomBBox(sigma.getBBox());
      framed = true;
      const start = sigma.viewportToGraph({ x, y });
      const node = graphPoint(graph, id);
      const dx = node.x - start.x;
      const dy = node.y - start.y;
      return (px, py) => {
        const at = sigma.viewportToGraph({ x: px, y: py });
        return { x: at.x + dx, y: at.y + dy };
      };
    },
  };
}
