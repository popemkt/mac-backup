/**
 * A canvas told in words, for an agent that cannot see it (plan 2026-10-02,
 * decision 16; C23 §4.4): what each item is and says, the box it takes up,
 * and how items stand to one another — what rests on what, what is in which
 * frame, what is linked, and what is near what, by a side in plain words
 * (`relations.ts`, the words `place` takes back).
 *
 * At three levels of detail, as tldraw's agent kit reads a page: the items
 * in focus in full, with their relations; the rest of what is on screen
 * blurred to what and where; and what is off screen as a count per frame.
 */
import type { CanvasBounds } from "./box.ts";
import type { CanvasCamera } from "./camera.ts";
import type { CanvasThread } from "./comments.ts";
import {
  canvasDepth,
  isFileNode,
  isGroupNode,
  isKbNode,
  isPathNode,
  isShapeNode,
  isTextNode,
  type CanvasAnchor,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasHead,
  type CanvasItemLink,
  type CanvasNode,
  type CanvasPathNode,
  type CanvasRoute,
  type CanvasShapeKind,
  type CanvasSide,
} from "./doc.ts";
import { headOf, routeBends } from "./edges.ts";
import { lintCanvas, type CanvasLint } from "./lint.ts";
import type { CanvasWorld } from "./world.ts";
import { ancestorsOf, canvasMembership } from "./membership.ts";
import { directionFrom, itemBounds, type CanvasDirection } from "./relations.ts";
import { restingOn } from "./snap.ts";
import type { CanvasLooks } from "./style-fields.ts";
import { paintName, styleOf, writtenLooks } from "./style.ts";

/** What a solid of each shape is called; a flat one goes by its shape's own name. */
const SOLID_NAMES: { readonly [K in CanvasShapeKind]: string } = {
  rect: "box",
  ellipse: "cylinder",
  diamond: "prism",
  triangle: "triangular prism",
  hexagon: "hexagonal prism",
  star: "star block",
  cloud: "cloud block",
  "arrow-left": "arrow block",
  "arrow-right": "arrow block",
  "arrow-up": "arrow block",
  "arrow-down": "arrow block",
  "check-box": "check box block",
  sphere: "sphere",
  cone: "cone",
};

/** What an item is, in a word: what a person would call it. */
export function itemKind(item: CanvasNode): string {
  if (isGroupNode(item)) return "frame";
  if (isKbNode(item)) return "card";
  if (isFileNode(item)) return "image";
  if (isTextNode(item)) return item.billboard === true ? "label" : "text";
  if (isShapeNode(item)) return canvasDepth(item) > 0 ? SOLID_NAMES[item.shape] : item.shape;
  if (isPathNode(item)) {
    if (item.closed === true) return "outline";
    return headOf(item, "from") === null && headOf(item, "to") === null ? "line" : "arrow";
  }
  return item.type;
}

/** The longest an item's words run in a description before they are cut. */
const MAX_WORDS = 120;

const cut = (text: string) =>
  text.length <= MAX_WORDS ? text : `${text.slice(0, MAX_WORDS - 1)}…`;

/** What an item says: its text, its label, its node's text, or its picture's file. */
function itemWords(item: CanvasNode, world: CanvasWorld): string {
  if (isTextNode(item)) return item.text;
  if ((isShapeNode(item) || isGroupNode(item)) && item.label !== undefined) return item.label;
  if (item.nodeId !== undefined) return world.textOf(item.nodeId) ?? "";
  if (isFileNode(item)) return item.file;
  return "";
}

const round = (v: number) => Math.round(v * 100) / 100;
const rounded = ({ min, max }: CanvasBounds): CanvasBounds => ({
  min: { x: round(min.x), y: round(min.y), z: round(min.z) },
  max: { x: round(max.x), y: round(max.y), z: round(max.z) },
});

/** An item as a description gives it: in full when in focus, blurred to what and where otherwise. */
export interface DescribedItem {
  readonly id: string;
  readonly kind: string;
  readonly words: string;
  /** The box it takes up along the canvas's axes: x right, y down the page, z up. */
  readonly box: CanvasBounds;
  readonly detail: "focus" | "blurry";
  readonly nodeId?: string;
  /** Where it leads when followed. */
  readonly link?: CanvasItemLink;
  readonly frame?: string;
  readonly rotation?: CanvasNode["rotation"];
  readonly faces?: "camera";
  /** Its colour by name (a palette entry's) or as written. */
  readonly color?: string;
  /** The looks it draws that are not its kind's defaults (`styleOf`). */
  readonly style?: CanvasLooks;
  /** A line's points, whether it closes and the heads its ends wear, as `make.line` takes them. */
  readonly line?: DescribedLine;
}

/** A line as `place`'s `make.line` takes it: its points in its box, closed or not, each head worn. */
export interface DescribedLine {
  readonly points: readonly CanvasAnchor[];
  readonly closed?: true;
  readonly fromHead?: CanvasHead;
  readonly toHead?: CanvasHead;
}

/** How two items stand: `from` is `kind` `to` — on it, in it, linked to it, or `side` of it. */
export type DescribedRelation =
  | { readonly kind: "on" | "in"; readonly from: string; readonly to: string }
  | {
      readonly kind: "linked";
      readonly from: string;
      readonly to: string;
      readonly edge: string;
      readonly label?: string;
      readonly field?: string;
      /** Where each end meets its item, as `connect` takes it: a side, or a precise anchor. */
      readonly fromSide?: CanvasSide;
      readonly toSide?: CanvasSide;
      readonly fromAnchor?: CanvasAnchor;
      readonly toAnchor?: CanvasAnchor;
      /** How it runs, where not JSON Canvas's curve, and its bend where its route takes one. */
      readonly route?: CanvasRoute;
      readonly bend?: number;
      /** The head an end wears ("none": bare), where not JSON Canvas's: bare leaving, an arrow arriving. */
      readonly fromHead?: CanvasHead | "none";
      readonly toHead?: CanvasHead | "none";
      /** Its colour: a palette name, or as written. */
      readonly color?: string;
      /** The looks it draws that are not an edge's defaults. */
      readonly style?: CanvasLooks;
    }
  | {
      readonly kind: "near";
      readonly from: string;
      readonly to: string;
      readonly side: CanvasDirection;
      readonly gap: number;
    };

/** What is off screen: how many items, by kind, in each frame that belongs to no other (null: none). */
export interface DescribedCluster {
  readonly frame: string | null;
  readonly count: number;
  readonly kinds: Readonly<Record<string, number>>;
}

export interface CanvasDescription {
  readonly items: readonly DescribedItem[];
  /** The comment threads on the canvas, each with where it is pinned and whether it is resolved. */
  readonly comments: readonly CanvasThread[];
  readonly relations: readonly DescribedRelation[];
  readonly peripheral: readonly DescribedCluster[];
  readonly lints: readonly CanvasLint[];
  readonly camera?: CanvasCamera;
}

export interface DescribeOptions {
  /** The canvas described: the node whose document it is. */
  readonly canvasId: string;
  /** The kb the canvas reads, in which `canvasId` holds the document. */
  readonly world: CanvasWorld;
  /** The items in focus, in full; every item when absent. */
  readonly focus?: ReadonlySet<string>;
  /** The items on screen; outside focus they are blurred, off it they are counted. Every item when absent. */
  readonly visible?: ReadonlySet<string>;
}

/** How far apart two items can be and still be near, canvas units: five grid steps. */
const NEAR = 100;
/** How many near neighbours an item in focus is described with, nearest first. */
const MAX_NEAR = 4;

/** Each item in focus with its nearest neighbours, by a side and a gap; each pair once. */
function nearRelations(
  items: readonly CanvasNode[],
  focus: ReadonlySet<string>,
): DescribedRelation[] {
  const placed = items.filter((item) => !isGroupNode(item));
  const bounds = new Map(placed.map((item) => [item.id, itemBounds(item)]));
  const seen = new Set<string>();
  const out: DescribedRelation[] = [];
  for (const item of placed) {
    if (!focus.has(item.id)) continue;
    const own = bounds.get(item.id);
    if (own === undefined) continue;
    const near = placed
      .flatMap((other) => {
        const of = bounds.get(other.id);
        if (other.id === item.id || of === undefined) return [];
        const where = directionFrom(own, of);
        return where === null || where.gap > NEAR ? [] : [{ other, ...where }];
      })
      .toSorted((a, b) => a.gap - b.gap)
      .slice(0, MAX_NEAR);
    for (const { other, direction, gap } of near) {
      const pair = [item.id, other.id].toSorted().join("|");
      if (seen.has(pair)) continue;
      seen.add(pair);
      out.push({ kind: "near", from: item.id, to: other.id, side: direction, gap: round(gap) });
    }
  }
  return out;
}

/** Each item at the detail it is described at, and what is off screen counted per frame. */
function describeItems(
  doc: CanvasDoc,
  options: DescribeOptions,
  focus: ReadonlySet<string>,
  visible: ReadonlySet<string>,
): { items: DescribedItem[]; peripheral: DescribedCluster[] } {
  const membership = canvasMembership(doc.nodes);
  const items: DescribedItem[] = [];
  const clusters = new Map<string | null, { count: number; kinds: Record<string, number> }>();
  for (const node of doc.nodes) {
    const kind = itemKind(node);
    if (!focus.has(node.id) && !visible.has(node.id)) {
      const top = ancestorsOf(membership, node.id).at(-1) ?? null;
      const cluster = clusters.get(top) ?? { count: 0, kinds: {} };
      cluster.count += 1;
      cluster.kinds[kind] = (cluster.kinds[kind] ?? 0) + 1;
      clusters.set(top, cluster);
      continue;
    }
    const words = cut(itemWords(node, options.world));
    const base = { id: node.id, kind, words, box: rounded(itemBounds(node)) };
    if (!focus.has(node.id)) {
      items.push({ ...base, detail: "blurry" });
      continue;
    }
    const frame = membership.parentOf(node.id);
    const { color } = styleOf(node);
    const looks = writtenLooks(node);
    items.push({
      ...base,
      detail: "focus",
      ...(color === undefined ? {} : { color: paintName(color) }),
      ...(Object.keys(looks).length === 0 ? {} : { style: looks }),
      ...(node.nodeId === undefined ? {} : { nodeId: node.nodeId }),
      ...(node.link === undefined ? {} : { link: node.link }),
      ...(frame === null ? {} : { frame }),
      ...(node.rotation === undefined ? {} : { rotation: node.rotation }),
      ...(node.billboard === true ? { faces: "camera" as const } : {}),
      ...(node.locked === true ? { locked: true as const } : {}),
      ...(isPathNode(node) ? { line: describedLine(node) } : {}),
    });
  }
  const peripheral = [...clusters].map(([frame, { count, kinds }]) => ({ frame, count, kinds }));
  return { items, peripheral };
}

/** A line as `make.line` takes it (`DescribedLine`): only the heads its ends wear. */
function describedLine(line: CanvasPathNode): DescribedLine {
  const [fromHead, toHead] = [headOf(line, "from"), headOf(line, "to")];
  return {
    points: line.points.map(({ x, y }) => ({ x: round(x), y: round(y) })),
    ...(line.closed === true ? { closed: true as const } : {}),
    ...(fromHead === null ? {} : { fromHead }),
    ...(toHead === null ? {} : { toHead }),
  };
}

/** How an edge meets its items and is drawn, in the words `connect` takes: only what is not JSON Canvas's default. */
function edgeLook(edge: CanvasEdge) {
  const { color } = styleOf(edge);
  const looks = writtenLooks(edge);
  const fromHead: CanvasHead | "none" = headOf(edge, "from") ?? "none";
  const toHead: CanvasHead | "none" = headOf(edge, "to") ?? "none";
  const { fromSide, toSide, fromAnchor, toAnchor, bend } = edge;
  return {
    ...(fromSide === undefined ? {} : { fromSide }),
    ...(toSide === undefined ? {} : { toSide }),
    ...(fromAnchor === undefined ? {} : { fromAnchor }),
    ...(toAnchor === undefined ? {} : { toAnchor }),
    ...(edge.route === undefined || edge.route === "curve" ? {} : { route: edge.route }),
    ...(bend === undefined || !routeBends(edge.route) ? {} : { bend }),
    ...(fromHead === "none" ? {} : { fromHead }),
    ...(toHead === "arrow" ? {} : { toHead }),
    ...(color === undefined ? {} : { color: paintName(color) }),
    ...(Object.keys(looks).length === 0 ? {} : { style: looks }),
  };
}

/** What rests on what, what is in which frame, and what is linked: every item's, every edge's. */
function placedRelations(doc: CanvasDoc): DescribedRelation[] {
  const membership = canvasMembership(doc.nodes);
  const solids = doc.nodes.filter((node) => !isGroupNode(node));
  const relations: DescribedRelation[] = [];
  for (const node of doc.nodes) {
    const frame = membership.parentOf(node.id);
    if (frame !== null) relations.push({ kind: "in", from: node.id, to: frame });
    const under = isGroupNode(node) ? null : restingOn(node, solids);
    if (under !== null) relations.push({ kind: "on", from: node.id, to: under.id });
  }
  for (const edge of doc.edges) {
    relations.push({
      kind: "linked",
      from: edge.fromNode,
      to: edge.toNode,
      edge: edge.id,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      ...(edge.kbLink?.mode === "native" ? { field: edge.kbLink.fieldId } : {}),
      ...edgeLook(edge),
    });
  }
  return relations;
}

const pairOf = (r: { from: string; to: string }) => [r.from, r.to].toSorted().join("|");

/** The description's camera: the one its view node holds, when it holds one. */
function cameraOf(camera: CanvasCamera | undefined): { camera?: CanvasCamera } {
  return camera === undefined ? {} : { camera };
}

/** `doc` described at the detail `options` asks for. */
export function describeCanvas(doc: CanvasDoc, options: DescribeOptions): CanvasDescription {
  const all = new Set(doc.nodes.map((node) => node.id));
  const focus = options.focus ?? all;
  const visible = options.visible ?? all;
  const { items, peripheral } = describeItems(doc, options, focus, visible);
  const placed = placedRelations(doc);
  const related = new Set(placed.map(pairOf));
  // Two items already on, in or linked are not also said to be near.
  const near = nearRelations(doc.nodes, focus).filter((r) => !related.has(pairOf(r)));
  const touches = (r: { from: string; to: string }) => focus.has(r.from) || focus.has(r.to);
  return {
    items,
    comments: options.world.threadsOn(options.canvasId),
    relations: [...placed.filter(touches), ...near],
    peripheral,
    lints: lintCanvas(options.canvasId, doc, options.world),
    ...cameraOf(options.world.cameraOf(options.canvasId)),
  };
}
