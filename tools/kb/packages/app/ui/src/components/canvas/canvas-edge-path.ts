import type { CanvasEdge, CanvasNode, CanvasSide } from "@kb/canvas";

export function sidePoint(node: CanvasNode, side: CanvasSide = "right"): { x: number; y: number } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  switch (side) {
    case "top":
      return { x: cx, y: node.y };
    case "bottom":
      return { x: cx, y: node.y + node.height };
    case "left":
      return { x: node.x, y: cy };
    case "right":
    default:
      return { x: node.x + node.width, y: cy };
  }
}

/** Cubic bezier between two card sides (JSON Canvas–style). */
export function edgePath(from: CanvasNode, to: CanvasNode, edge: CanvasEdge): string {
  const a = sidePoint(from, edge.fromSide ?? "right");
  const b = sidePoint(to, edge.toSide ?? "left");
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
  const c1x =
    a.x + (edge.fromSide === "left" ? -dx : edge.fromSide === "right" || !edge.fromSide ? dx : 0);
  const c1y = a.y + (edge.fromSide === "top" ? -dx : edge.fromSide === "bottom" ? dx : 0);
  const c2x =
    b.x + (edge.toSide === "right" ? dx : edge.toSide === "left" || !edge.toSide ? -dx : 0);
  const c2y = b.y + (edge.toSide === "top" ? -dx : edge.toSide === "bottom" ? dx : 0);
  return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
}
