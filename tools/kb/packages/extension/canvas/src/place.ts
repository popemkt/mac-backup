/**
 * Placing an item by a relation (plan 2026-10-02, decision 16): beside
 * another (`near`, a side and a gap), on top of it (`on`), inside a frame
 * (`in`), or at plain coordinates (`at`) — so an agent says where, and
 * never works out a coordinate. The relation is resolved through the code
 * a person's gestures go through: the item's record moves by the one
 * transform (`transformItem`), lands by surface snap (`snapToSurface`),
 * carries its members as an edit of its box does (`editItem`), is laid on a
 * frame that stands as a placing tool lays it (`placedOnFace`), and belongs
 * where the drop rule says (`settleMembership`). Where the first spot is
 * taken, it steps along by the grid until it is clear (`overlaps`).
 */
import { boxFrame, boxToWorld, type CanvasBounds, type CanvasVec } from "./box.ts";
import { isGroupNode, withElevation, type CanvasDoc, type CanvasNode } from "./doc.ts";
import {
  canvasMembership,
  carriedBy,
  editItem,
  faceHolds,
  settleMembership,
} from "./membership.ts";
import { coversFromAbove } from "./pick.ts";
import { placedOnFace } from "./presets.ts";
import {
  CanvasRelationError,
  boundsCentre,
  directionAxis,
  itemBounds,
  overlaps,
  type CanvasDirection,
} from "./relations.ts";
import { GRID_STEP, snapToSurface } from "./snap.ts";
import { moveBy, transformItem } from "./transform.ts";

/** Where an item goes, said as a relation to what is already there. */
export type CanvasWhere =
  | {
      /** Beside this item, on `side` of it, `gap` from it (a grid step when absent). */
      readonly near: string;
      readonly side: CanvasDirection;
      readonly gap?: number;
    }
  | { /** On top of this item, centred on it (a frame: in it). */ readonly on: string }
  | { /** Inside this frame, at the first spot clear of its other members. */ readonly in: string }
  | {
      /** The top left of the box it takes up at x, y, its base at `z`; with none, it lands as a carry does. */
      readonly at: { readonly x: number; readonly y: number; readonly z?: number };
    };

/** How many grid steps a placement looks along for a clear spot before it takes the first. */
const MAX_STEPS = 48;

/** `item` moved by `by`, through the one transform path. */
function moved(item: CanvasNode, by: CanvasVec): CanvasNode {
  return transformItem(item, moveBy(boxFrame(item).centre, by));
}

/** What is being placed: its record now, and where it was — null for a new item, which was nowhere. */
interface Placing {
  readonly item: CanvasNode;
  readonly origin: CanvasNode | null;
  /** What else is on the canvas: everything but the item and what it carries. */
  readonly others: readonly CanvasNode[];
}

/**
 * The item moved by `by` across the floor plan and landed as a carry lands
 * (`snapToSurface`): on the highest solid its centre comes over, else at
 * its height — unless it stood on one where it was, and then on the floor.
 * A new item stood nowhere, so it stands on what is under it or keeps the
 * height its preset gives it.
 */
function landed({ item, origin, others }: Placing, by: { x: number; y: number }): CanvasNode {
  const there = moved(item, { x: by.x, y: by.y, z: 0 });
  const { dz } =
    origin === null
      ? snapToSurface(there, others, 0, 0)
      : snapToSurface(origin, others, there.x - origin.x, there.y - origin.y);
  return moved(there, { x: 0, y: 0, z: dz });
}

/** The first of `spots` clear of `others`, or the first of them when none is. */
function firstClear(
  spots: readonly CanvasNode[],
  others: readonly CanvasNode[],
): CanvasNode | null {
  return spots.find((spot) => !others.some((other) => overlaps(spot, other))) ?? spots[0] ?? null;
}

/** The item `id` names, or a relation error saying which is missing. */
function named(nodes: readonly CanvasNode[], id: string, role: string): CanvasNode {
  const found = nodes.find((node) => node.id === id);
  if (found === undefined) throw new CanvasRelationError(`no item ${id} on this canvas to ${role}`);
  return found;
}

const extent = ({ min, max }: CanvasBounds): CanvasVec => ({
  x: max.x - min.x,
  y: max.y - min.y,
  z: max.z - min.z,
});

/**
 * The spots beside `target` on `side`, nearest first, each a grid step
 * further out: out along the side's axis by `gap`, centred on the target
 * across it, and — beside it on the floor plan — level with it, its base
 * aligned with the target's as alignment snap aligns bases. Off the edge of
 * whatever the target stands on it stays level, and the lints say it floats.
 */
function besideSpots(
  { item }: Placing,
  target: CanvasNode,
  side: CanvasDirection,
  gap: number,
): CanvasNode[] {
  const own = itemBounds(item);
  const size = extent(own);
  const of = itemBounds(target);
  const mid = boundsCentre(of);
  const { axis, sign } = directionAxis(side);
  const along = sign > 0 ? of.max[axis] + gap : of.min[axis] - gap - size[axis];
  const min = {
    x: axis === "x" ? along : mid.x - size.x / 2,
    y: axis === "y" ? along : mid.y - size.y / 2,
    z: axis === "z" ? along : of.min.z,
  };
  return Array.from({ length: MAX_STEPS }, (_, k) => {
    const out = sign * k * GRID_STEP;
    return moved(item, {
      x: min.x - own.min.x + (axis === "x" ? out : 0),
      y: min.y - own.min.y + (axis === "y" ? out : 0),
      z: min.z - own.min.z + (axis === "z" ? out : 0),
    });
  });
}

/** Grid offsets across the floor plan, nearest first: the centre, then rings out to `reach`. */
function ringOffsets(reach: number): { x: number; y: number }[] {
  const steps = Math.max(0, Math.ceil(reach / GRID_STEP));
  const offsets: { x: number; y: number }[] = [];
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) offsets.push({ x: i * GRID_STEP, y: j * GRID_STEP });
  }
  return offsets.toSorted((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
}

/**
 * The spots on top of `target`, centred on it first, each standing its base
 * on the target's top (as surface snap stands it) with its centre over it.
 */
function onSpots({ item }: Placing, target: CanvasNode): CanvasNode[] {
  const of = itemBounds(target);
  const mid = boundsCentre(of);
  const own = itemBounds(item);
  const centre = boundsCentre(own);
  const centred = { x: mid.x - centre.x, y: mid.y - centre.y, z: of.max.z - own.min.z };
  const reach = Math.max(of.max.x - of.min.x, of.max.y - of.min.y) / 2;
  return ringOffsets(reach)
    .map((offset) => moved(item, { ...centred, x: centred.x + offset.x, y: centred.y + offset.y }))
    .filter((spot) => coversFromAbove(target, boundsCentre(itemBounds(spot))));
}

/**
 * The spots inside `frame`, row by row from its top left a grid step in,
 * each with the item's centre on its face. On a frame that lies facing up
 * the item stands on the floor plan under it, unturned, as a placing tool
 * puts it there; on one that stands it is laid on its face, turned as it
 * is — a new item lifted off it by its preset's height, as a tool lifts it,
 * a moved one laid flat on it.
 */
function inSpots(placing: Placing, frame: CanvasNode): CanvasNode[] {
  const { item, origin } = placing;
  const face = boxFrame(frame);
  const facesUp = face.matrix[8] > 1 - 1e-9;
  const onFace = origin === null ? item : withElevation(item, 0);
  /** The item with its top left at `local` on the face. */
  const at = (local: { x: number; y: number }) => {
    const point = boxToWorld(face, { ...local, z: 0 });
    return facesUp
      ? landed(placing, { x: point.x - item.x, y: point.y - item.y })
      : placedOnFace(onFace, face, point);
  };
  const { half } = face;
  const spots: CanvasNode[] = [];
  for (let v = -half.y + GRID_STEP; v + item.height <= half.y - GRID_STEP + 1e-9; v += GRID_STEP) {
    for (let u = -half.x + GRID_STEP; u + item.width <= half.x - GRID_STEP + 1e-9; u += GRID_STEP) {
      const spot = at({ x: u, y: v });
      if (faceHolds(frame, spot)) spots.push(spot);
    }
  }
  // Too big for a spot a grid step in: centred on the frame, for the drop rule to judge.
  return spots.length > 0 ? spots : [at({ x: -item.width / 2, y: -item.height / 2 })];
}

/** Where `where` puts the item, best first. */
function spotsFor(placing: Placing, where: CanvasWhere): CanvasNode[] {
  const { item, others } = placing;
  if ("at" in where) {
    const { x, y, z } = where.at;
    // The top left of the box it takes up, as `describe` gives boxes, however it is turned.
    const { min } = itemBounds(item);
    const by = { x: x - min.x, y: y - min.y };
    return [z === undefined ? landed(placing, by) : withElevation(moved(item, { ...by, z: 0 }), z)];
  }
  if ("near" in where) {
    const target = named(others, where.near, "place beside");
    return besideSpots(placing, target, where.side, where.gap ?? GRID_STEP);
  }
  const id = "on" in where ? where.on : where.in;
  const target = named(others, id, "place on or in");
  if (isGroupNode(target)) return inSpots(placing, target);
  if ("in" in where) throw new CanvasRelationError(`${id} is not a frame, so nothing goes in it`);
  return onSpots(placing, target);
}

/** The item a relation is taken from, if it names one. */
function targetOf(where: CanvasWhere): string | null {
  if ("near" in where) return where.near;
  if ("on" in where) return where.on;
  if ("in" in where) return where.in;
  return null;
}

/**
 * `doc` with `item` placed where `where` says, and the item as it landed.
 * `item` is one of `doc`'s items, which moves with its members, or a new
 * one, which is added. It belongs to the frame that holds it where it
 * lands (`settleMembership`); placed `in` a frame that cannot hold it — it
 * is larger than the frame — the placement is refused. Throws
 * `CanvasRelationError` naming what it could not resolve.
 */
export function placeItem(
  doc: CanvasDoc,
  item: CanvasNode,
  where: CanvasWhere,
): { readonly doc: CanvasDoc; readonly item: CanvasNode } {
  const origin = doc.nodes.find((node) => node.id === item.id) ?? null;
  const start = origin === null ? { ...doc, nodes: [...doc.nodes, item] } : doc;
  const record = origin ?? item;
  const { items, members } = carriedBy(start.nodes, [record.id]);
  const carried = new Set([...items, ...members].map((node) => node.id));
  const target = targetOf(where);
  if (target !== null && carried.has(target)) {
    throw new CanvasRelationError(`${record.id} cannot be placed by ${target}, which it carries`);
  }
  const others = start.nodes.filter((node) => !carried.has(node.id));
  const placing: Placing = { item: record, origin, others };
  /** The canvas with the item let go at `spot`: in whatever frame holds it there. */
  const settled = (spot: CanvasNode) => settleMembership(editItem(start, spot), [record.id]);
  // In a frame means held by that frame, not by one nested in it.
  const spots = spotsFor(placing, where).filter(
    (spot) =>
      !("in" in where) || canvasMembership(settled(spot).nodes).parentOf(record.id) === where.in,
  );
  const spot = firstClear(spots, others);
  if (spot === null) {
    throw new CanvasRelationError(
      "in" in where
        ? `${record.id} does not fit in frame ${where.in}`
        : `there is nowhere to place ${record.id} there`,
    );
  }
  const placed = settled(spot);
  const landedItem = placed.nodes.find((node) => node.id === record.id) ?? spot;
  return { doc: placed, item: landedItem };
}
