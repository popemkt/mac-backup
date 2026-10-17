/**
 * Laying items out (plan 2026-10-02, decision 16): a row, a column, a grid,
 * a ring or a stack, or layers, where an item's height follows a value its
 * node holds — a 3D view of the graph that an agent never places by hand —
 * and lined up along an edge or spread evenly. Also the other acts on a
 * set's arrangement: the order it paints in (`orderItems`) and a mirror of
 * it (`flipItems`).
 * Each item moves through the one transform path, carrying its members as
 * an edit of its box does (`editItem`), lands on the floor plan as a carry
 * lands (`snapToSurface`) unless the layout sets its height, and belongs
 * where the drop rule says once it is let go (`settleMembership`).
 */
import { boxBounds, boxFrame, type CanvasBounds, type CanvasVec } from "./box.ts";
import type { CanvasDoc, CanvasNode } from "./doc.ts";
import { mirroredEdge } from "./edges.ts";
import { carriedBy, editItem, settleMembership } from "./membership.ts";
import { boundsCentre, itemBounds } from "./relations.ts";
import { GRID_STEP, snapToSurface } from "./snap.ts";
import {
  moveBy,
  reflectItem,
  selectionPivot,
  transformItem,
  type CanvasFlipAxis,
} from "./transform.ts";

/** The layouts, each named as an agent asks for it. */
export const CANVAS_LAYOUTS = [
  "row",
  "column",
  "grid",
  "ring",
  "stack",
  "layers",
  "align",
  "distribute",
] as const;
export type CanvasLayout = (typeof CANVAS_LAYOUTS)[number];

/** The edge an `align` lines items up on: one of the set's sides, or its middle across or down. */
export const CANVAS_ALIGN_EDGES = ["left", "centre", "right", "top", "middle", "bottom"] as const;
export type CanvasAlignEdge = (typeof CANVAS_ALIGN_EDGES)[number];

/** A value an item's layer is ordered by: a number, or words. */
export type CanvasLayerValue = number | string;

/** How a set of items is laid out. */
export interface CanvasArrangement {
  readonly layout: CanvasLayout;
  /** The room between neighbours (between layers' bases, for layers), canvas units. */
  readonly gap?: number;
  /** How many items a grid's row holds; the square root of the count, rounded up, when absent. */
  readonly columns?: number;
  /** For layers: the value an item's layer is ordered by; undefined puts it on the lowest layer. */
  readonly layerOf?: (item: CanvasNode) => CanvasLayerValue | undefined;
  /** For align: the edge lined up on; the set's left when absent. */
  readonly edge?: CanvasAlignEdge;
  /** For distribute: the floor axis spread along; x when absent. */
  readonly axis?: CanvasFlipAxis;
}

/** How far apart layers stand by default, canvas units: a tall card's height and room above it. */
const LAYER_STEP = 160;

const extentOf = ({ min, max }: CanvasBounds): CanvasVec => ({
  x: max.x - min.x,
  y: max.y - min.y,
  z: max.z - min.z,
});

/** Where each item's centre goes on the floor plan, and its base when the layout sets it. */
interface Slot {
  readonly x: number;
  readonly y: number;
  readonly base?: number;
}

/** A row along x (or a column along y) from the set's top left, centred on one line. */
function lineSlots(
  bounds: readonly CanvasBounds[],
  all: CanvasBounds,
  along: "x" | "y",
  gap: number,
): Slot[] {
  const across = along === "x" ? "y" : "x";
  const thickest = Math.max(...bounds.map((b) => extentOf(b)[across]));
  const line = all.min[across] + thickest / 2;
  let cursor = all.min[along];
  return bounds.map((b) => {
    const size = extentOf(b)[along];
    const centre = cursor + size / 2;
    cursor += size + gap;
    return along === "x" ? { x: centre, y: line } : { x: line, y: centre };
  });
}

/** A grid of equal cells, row by row from the set's top left. */
function gridSlots(
  bounds: readonly CanvasBounds[],
  all: CanvasBounds,
  gap: number,
  columns: number,
): Slot[] {
  const cellW = Math.max(...bounds.map((b) => extentOf(b).x));
  const cellH = Math.max(...bounds.map((b) => extentOf(b).y));
  return bounds.map((_, i) => ({
    x: all.min.x + (i % columns) * (cellW + gap) + cellW / 2,
    y: all.min.y + Math.floor(i / columns) * (cellH + gap) + cellH / 2,
  }));
}

/**
 * A ring about the set's centre, from the north and clockwise as the top
 * view reads it, wide enough that neighbours keep `gap` between them.
 */
function ringSlots(bounds: readonly CanvasBounds[], all: CanvasBounds, gap: number): Slot[] {
  const centre = boundsCentre(all);
  const reach = bounds.map((b) => Math.hypot(extentOf(b).x, extentOf(b).y));
  const around = reach.reduce((sum, r) => sum + r + gap, 0);
  // One item is its own ring: it stays where it is.
  const radius = bounds.length < 2 ? 0 : Math.max(Math.max(...reach), around / (2 * Math.PI));
  return bounds.map((_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / bounds.length;
    return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
  });
}

/** A stack over the first item's centre: each on the one before, the first where it stands. */
function stackSlots(bounds: readonly CanvasBounds[]): Slot[] {
  const first = bounds[0];
  if (first === undefined) return [];
  const centre = boundsCentre(first);
  let base = first.min.z;
  return bounds.map((b) => {
    const slot = { x: centre.x, y: centre.y, base };
    base += extentOf(b).z;
    return slot;
  });
}

/** Each item's edge on the set's: across for left, centre and right, down for the rest. */
function alignSlots(
  bounds: readonly CanvasBounds[],
  all: CanvasBounds,
  edge: CanvasAlignEdge,
): Slot[] {
  const across = edge === "left" || edge === "centre" || edge === "right";
  const axis = across ? "x" : "y";
  return bounds.map((b) => {
    const centre = boundsCentre(b);
    const half = extentOf(b)[axis] / 2;
    const at =
      edge === "left" || edge === "top"
        ? all.min[axis] + half
        : edge === "right" || edge === "bottom"
          ? all.max[axis] - half
          : (all.min[axis] + all.max[axis]) / 2;
    return across ? { x: at, y: centre.y } : { x: centre.x, y: at };
  });
}

/**
 * The items spread along `axis` so the room between neighbours is even,
 * the first and the last where they stand, in the order they stand.
 */
function distributeSlots(bounds: readonly CanvasBounds[], axis: CanvasFlipAxis): Slot[] {
  const order = bounds
    .map((b, i) => ({ i, at: boundsCentre(b)[axis] }))
    .toSorted((a, b) => a.at - b.at)
    .map(({ i }) => i);
  const sizes = bounds.map((b) => extentOf(b)[axis]);
  const first = bounds[order[0] ?? 0];
  const last = bounds[order.at(-1) ?? 0];
  const slots: Slot[] = bounds.map((b) => boundsCentre(b));
  if (first === undefined || last === undefined || bounds.length < 3) return slots;
  const span = last.max[axis] - first.min[axis];
  const room = (span - sizes.reduce((sum, s) => sum + s, 0)) / (bounds.length - 1);
  let cursor = first.min[axis];
  for (const i of order) {
    const size = sizes[i] ?? 0;
    const centre = slots[i];
    if (centre !== undefined) slots[i] = { ...centre, [axis]: cursor + size / 2 };
    cursor += size + room;
  }
  return slots;
}

/** Words and numbers in one order: numbers first, ascending, then words as a reader sorts them. */
function byValue(a: CanvasLayerValue, b: CanvasLayerValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a.localeCompare(b);
}

/**
 * Layers: each item stays where it is across the floor plan, its base on
 * its layer, layers ordered by value from the floor up — items with no
 * value on the lowest, below the rest.
 */
function layerSlots(
  items: readonly CanvasNode[],
  bounds: readonly CanvasBounds[],
  gap: number,
  layerOf: (item: CanvasNode) => CanvasLayerValue | undefined,
): Slot[] {
  const values = items.map((item) => layerOf(item));
  const distinct = [...new Set(values.filter((v) => v !== undefined))].toSorted(byValue);
  const unvalued = values.some((v) => v === undefined) ? 1 : 0;
  return bounds.map((b, i) => {
    const value = values[i];
    const layer = value === undefined ? 0 : distinct.indexOf(value) + unvalued;
    const centre = boundsCentre(b);
    return { x: centre.x, y: centre.y, base: layer * gap };
  });
}

/** What a layout is laid out from: the items, their bounds, the set's, and the arrangement. */
interface LayoutInput {
  readonly arrangement: CanvasArrangement;
  readonly items: readonly CanvasNode[];
  readonly bounds: readonly CanvasBounds[];
  readonly all: CanvasBounds;
  readonly gap: number;
}

/** Each layout's slots, one entry per layout, so a layout with none does not type-check. */
const LAYOUT_SLOTS: { readonly [L in CanvasLayout]: (input: LayoutInput) => Slot[] } = {
  row: ({ bounds, all, gap }) => lineSlots(bounds, all, "x", gap),
  column: ({ bounds, all, gap }) => lineSlots(bounds, all, "y", gap),
  grid: ({ arrangement, bounds, all, gap }) =>
    gridSlots(
      bounds,
      all,
      gap,
      Math.max(1, arrangement.columns ?? Math.ceil(Math.sqrt(bounds.length))),
    ),
  ring: ({ bounds, all, gap }) => ringSlots(bounds, all, gap),
  stack: ({ bounds }) => stackSlots(bounds),
  layers: ({ arrangement, items, bounds, gap }) =>
    layerSlots(items, bounds, gap, arrangement.layerOf ?? (() => undefined)),
  align: ({ arrangement, bounds, all }) => alignSlots(bounds, all, arrangement.edge ?? "left"),
  distribute: ({ arrangement, bounds }) => distributeSlots(bounds, arrangement.axis ?? "x"),
};

function slotsFor(
  arrangement: CanvasArrangement,
  items: readonly CanvasNode[],
  bounds: readonly CanvasBounds[],
  all: CanvasBounds,
): Slot[] {
  const fallback = arrangement.layout === "layers" ? LAYER_STEP : GRID_STEP;
  const gap = Math.max(0, arrangement.gap ?? fallback);
  return LAYOUT_SLOTS[arrangement.layout]({ arrangement, items, bounds, all, gap });
}

/**
 * `doc` with the items `ids` name laid out by `arrangement`, in the order
 * named — a group's members follow it, and an id inside a named group is
 * carried by it rather than laid out itself. The set keeps its top left (a
 * ring and a stack their centre). Across the floor plan each lands as a
 * carry does, on what is under it; a stack and layers set its base.
 */
export function arrangeItems(
  doc: CanvasDoc,
  ids: readonly string[],
  arrangement: CanvasArrangement,
): CanvasDoc {
  const { items, members } = carriedBy(doc.nodes, ids);
  const all = boxBounds(items);
  if (all === null) return doc;
  const carried = new Set([...items, ...members].map((node) => node.id));
  const others = doc.nodes.filter((node) => !carried.has(node.id));
  const bounds = items.map(itemBounds);
  const slots = slotsFor(arrangement, items, bounds, all);
  let next = doc;
  items.forEach((item, i) => {
    const slot = slots[i];
    const b = bounds[i];
    if (slot === undefined || b === undefined) return;
    const centre = boundsCentre(b);
    const by = { x: slot.x - centre.x, y: slot.y - centre.y };
    const rise =
      slot.base === undefined ? snapToSurface(item, others, by.x, by.y).dz : slot.base - b.min.z;
    const spot = transformItem(item, moveBy(boxFrame(item).centre, { ...by, z: rise }));
    next = editItem(next, spot);
  });
  return settleMembership(
    next,
    items.map((item) => item.id),
  );
}

/** Where a set's paint order moves it: to the front or the back, or one step either way. */
export const CANVAS_ORDERS = ["front", "back", "forward", "backward"] as const;
export type CanvasOrder = (typeof CANVAS_ORDERS)[number];

/**
 * `doc` with the items `ids` name, and their members, moved in the order
 * the canvas paints in (document order, among items at one height,
 * `paintOrder`): all of them in front of the rest or behind them, or each
 * one step past the next item that is not moved. A frame still paints
 * under what it holds, wherever it stands in the order.
 */
export function orderItems(doc: CanvasDoc, ids: readonly string[], order: CanvasOrder): CanvasDoc {
  const { items, members } = carriedBy(doc.nodes, ids);
  const moved = new Set([...items, ...members].map((node) => node.id));
  if (moved.size === 0) return doc;
  const isMoved = (node: CanvasNode | undefined) => node !== undefined && moved.has(node.id);
  if (order === "front" || order === "back") {
    const kept = doc.nodes.filter((node) => !moved.has(node.id));
    const taken = doc.nodes.filter((node) => moved.has(node.id));
    return { ...doc, nodes: order === "front" ? [...kept, ...taken] : [...taken, ...kept] };
  }
  const nodes = [...doc.nodes];
  const step = order === "forward" ? 1 : -1;
  const indices = nodes.map((_, i) => i);
  for (const i of step === 1 ? indices.toReversed() : indices) {
    const [here, there] = [nodes[i], nodes[i + step]];
    if (here === undefined || there === undefined || !isMoved(here) || isMoved(there)) continue;
    nodes[i] = there;
    nodes[i + step] = here;
  }
  return { ...doc, nodes };
}

/**
 * `doc` with the items `ids` name, and their members, mirrored along
 * `axis` through the middle of the box round them (`reflectItem`), the
 * edges they meet meeting them where they did, as one act.
 */
export function flipItems(doc: CanvasDoc, ids: readonly string[], axis: CanvasFlipAxis): CanvasDoc {
  const { items, members } = carriedBy(doc.nodes, ids);
  if (items.length === 0) return doc;
  const pivot = selectionPivot(items);
  const flipped = new Map(
    [...items, ...members].map((node) => [node.id, reflectItem(node, axis, pivot)]),
  );
  const moved = new Map([...items, ...members].map((node) => [node.id, node]));
  const edges = doc.edges.map((edge) =>
    mirroredEdge(edge, axis, { from: moved.get(edge.fromNode), to: moved.get(edge.toNode) }),
  );
  const next = { ...doc, nodes: doc.nodes.map((node) => flipped.get(node.id) ?? node), edges };
  return settleMembership(
    next,
    items.map((item) => item.id),
  );
}
