/**
 * A frame clips what it holds (tldraw's frame): an item a frame holds is
 * drawn, and hit, only where every frame above it reaches, seen from above.
 * A frame's reach is its box's top view (`boxCorners`), and an item's clip
 * the meeting of its frames' reaches: a convex region of the canvas floor,
 * standing up through every height. Every projection draws it and hit-tests
 * by it from here (DESIGN-UI.md → Frames clip what they hold).
 */
import { boxCorners } from "./box.ts";
import type { CanvasNode } from "./doc.ts";
import { ancestorsOf, canvasMembership } from "./membership.ts";

/** A point of the canvas floor: across, then down. */
export type CanvasFloorPoint = readonly [x: number, y: number];

/**
 * A region of the canvas floor seen from above: a convex polygon, its
 * corners in order round it (any winding), standing up through every height.
 * Empty, the region holds nothing.
 */
export type CanvasClip = readonly CanvasFloorPoint[];

/** Twice the signed area `a`, `b`, `c` turn through: positive turning one way, negative the other. */
const turn = (a: CanvasFloorPoint, b: CanvasFloorPoint, c: CanvasFloorPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** The convex hull of `points`, counter-clockwise as the floor's axes turn (monotone chain). */
function hull(points: readonly CanvasFloorPoint[]): CanvasFloorPoint[] {
  const sorted = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (from: readonly CanvasFloorPoint[]) => {
    const chain: CanvasFloorPoint[] = [];
    for (const p of from) {
      while (chain.length >= 2 && turn(chain.at(-2) ?? p, chain.at(-1) ?? p, p) <= 0) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half(sorted.toReversed())];
}

/** What a frame reaches over, seen from above: the hull of its box's corners on the floor. */
function reachOf(frame: CanvasNode): CanvasFloorPoint[] {
  return hull(boxCorners(frame).map((c): CanvasFloorPoint => [c.x, c.y]));
}

/**
 * The part of convex `subject` inside convex `by`, both wound the one way
 * `hull` winds (Sutherland–Hodgman): each side of `by` keeps what lies on
 * its inner side.
 */
function meet(subject: readonly CanvasFloorPoint[], by: readonly CanvasFloorPoint[]) {
  let out: CanvasFloorPoint[] = [...subject];
  by.forEach((a, i) => {
    const b = by[(i + 1) % by.length] ?? a;
    const kept: CanvasFloorPoint[] = [];
    out.forEach((p, j) => {
      const q = out[(j + 1) % out.length] ?? p;
      const [sp, sq] = [turn(a, b, p), turn(a, b, q)];
      if (sp >= 0) kept.push(p);
      if (sp * sq < 0) {
        const t = sp / (sp - sq);
        kept.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    });
    out = kept;
  });
  return out;
}

/**
 * Each item a frame holds, with its clip: where every frame above it
 * reaches, seen from above. An item no frame holds is drawn whole, so it
 * is absent.
 */
export function itemClips(nodes: readonly CanvasNode[]): ReadonlyMap<string, CanvasClip> {
  const membership = canvasMembership(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const reaches = new Map<string, CanvasFloorPoint[]>();
  const reach = (id: string) => {
    const frame = byId.get(id);
    if (frame === undefined) return null;
    const known = reaches.get(id) ?? reachOf(frame);
    reaches.set(id, known);
    return known;
  };
  const clips = new Map<string, CanvasClip>();
  for (const node of nodes) {
    const [first, ...rest] = ancestorsOf(membership, node.id).flatMap((id) => {
      const known = reach(id);
      return known === null ? [] : [known];
    });
    if (first === undefined) continue;
    clips.set(
      node.id,
      rest.reduce((region, by) => meet(region, by), first),
    );
  }
  return clips;
}

/** Whether the floor point `x`, `y` lies in `clip`, its edge counted in. */
export function inClip(clip: CanvasClip, x: number, y: number): boolean {
  if (clip.length < 3) return false;
  const sides = clip.map((a, i) => turn(a, clip[(i + 1) % clip.length] ?? a, [x, y]));
  return sides.every((s) => s >= -1e-9) || sides.every((s) => s <= 1e-9);
}
