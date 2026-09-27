/**
 * The 2D graphs' side of a node drag (`lib/graph-drag`): the surface is
 * sigma's camera — suspended while a press is down, and inverted to put the
 * node under the pointer — and a placed layout (radial, hierarchical, grid,
 * the cluster placement) only moves the node it holds. The force layout is
 * its own `DragLayout` (`fa2-layout`).
 */
import type Graph from "graphology";
import type Sigma from "sigma";
import type { DragLayout, DragSurface } from "@/lib/graph-drag";

/** A layout with no forces: a held node stands where it is put, and nothing else moves. */
export function placedDrag(graph: Graph): DragLayout {
  return {
    grab: () => {},
    hold: (id, at) => {
      if (graph.hasNode(id)) graph.mergeNodeAttributes(id, { x: at.x, y: at.y });
    },
    drop: () => {},
  };
}

/** Sigma's camera as a drag surface: still while pressed, and the node kept at its press offset. */
export function sigmaDragSurface(sigma: Sigma): DragSurface {
  return {
    suspend: () => sigma.getCamera().disable(),
    resume: () => sigma.getCamera().enable(),
    grip: (id, x, y) => {
      const graph = sigma.getGraph();
      if (!graph.hasNode(id)) return null;
      const start = sigma.viewportToGraph({ x, y });
      const x0: unknown = graph.getNodeAttribute(id, "x");
      const y0: unknown = graph.getNodeAttribute(id, "y");
      const dx = typeof x0 === "number" ? x0 - start.x : 0;
      const dy = typeof y0 === "number" ? y0 - start.y : 0;
      return (px, py) => {
        const at = sigma.viewportToGraph({ x: px, y: py });
        return { x: at.x + dx, y: at.y + dy };
      };
    },
  };
}
