import {
  boxFrame,
  boxToWorld,
  directionToWorld,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
  type CanvasVec,
} from "@kb/canvas";

/** Where an edge meets an item's side, and which way out of the item that side faces. */
export interface SideAnchor {
  /** The middle of the side, halfway up it (on a flat item, its plane). */
  readonly at: CanvasVec;
  /** The side's outward direction across the floor, unit length. */
  readonly out: { readonly x: number; readonly y: number };
}

/** Each side's middle and outward direction in the box's own frame, by its unit half extents. */
const SIDES: { readonly [S in CanvasSide]: { readonly x: number; readonly y: number } } = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * Where an edge meets `node`'s `side`, in canvas space: the one answer the 2D
 * path, its drag preview, the 3D curve and the nearest-port choice all read.
 */
// A flat billboard stands up in 3D, but an edge meets it at its box's side
// on the floor, where it lies; and a turned billboard's anchors turn with a
// rotation it does not draw. Anchors on what is drawn come with 3D plan step 9.
// GAP [billboard-edge-anchors]
export function sideAnchor(node: CanvasNode, side: CanvasSide = "right"): SideAnchor {
  const frame = boxFrame(node);
  const unit = SIDES[side];
  const at = boxToWorld(frame, { x: unit.x * frame.half.x, y: unit.y * frame.half.y, z: 0 });
  const out = directionToWorld(frame, { x: unit.x, y: unit.y, z: 0 });
  const across = Math.hypot(out.x, out.y) || 1;
  return { at, out: { x: out.x / across, y: out.y / across } };
}

/** The point an edge meets `node`'s `side` at, as the top view draws it. */
export function sidePoint(node: CanvasNode, side: CanvasSide = "right"): { x: number; y: number } {
  const { at } = sideAnchor(node, side);
  return { x: at.x, y: at.y };
}

/** A bezier's first control point: `reach` out of the side `anchor` faces. */
export function leaving(anchor: SideAnchor, reach: number): { x: number; y: number } {
  return { x: anchor.at.x + anchor.out.x * reach, y: anchor.at.y + anchor.out.y * reach };
}

/** Cubic bezier between two card sides (JSON Canvas–style). */
export function edgePath(from: CanvasNode, to: CanvasNode, edge: CanvasEdge): string {
  const a = sideAnchor(from, edge.fromSide ?? "right");
  const b = sideAnchor(to, edge.toSide ?? "left");
  const reach = Math.max(40, Math.abs(b.at.x - a.at.x) * 0.45);
  const c1 = leaving(a, reach);
  const c2 = leaving(b, reach);
  return `M ${a.at.x} ${a.at.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.at.x} ${b.at.y}`;
}
