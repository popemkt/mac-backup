/**
 * JSON Canvas 1.0 document helpers + kbLink edge bindings.
 * Spec: https://jsoncanvas.org/spec/1.0/
 *
 * Unknown node types and extra fields round-trip (forward compatible). kb's
 * own extension fields are typed here: `nodeId`, `z`, `depth`,
 * `rotation`, `parent`, `link` and `style` on any item, `shape` on a shape item,
 * `points`, `closed` and the heads on a `path` item, `kbLink`, the
 * anchors, `route`, `bend`, the heads and `style` on an edge. How a canvas
 * is looked at is not the document's: it is its view node's (`./camera.ts`).
 * The format, as agents write it, is DESIGN.md → Canvas documents.
 */
import { isAssetPath, mediaKindFromHref } from "@kb/model";
import { boxRotation, boxTop } from "./box.ts";
import { dropExtra } from "./extra.ts";
import { isLinkNode, parseItemLink, type CanvasItemLink, type CanvasLinkNode } from "./links.ts";
import {
  fieldKeys,
  bool,
  finite,
  isRecord,
  oneOf,
  readFields,
  text,
  writeFields,
  writeUnread,
  type FieldCodecs,
} from "./fields.ts";
import { normalizeDegrees, type CanvasRotation } from "./rotation.ts";
import { emitStyleField, parseStyleField, type CanvasStyleField } from "./style-fields.ts";

/** The four sides of an item's box an edge may leave or arrive by (JSON Canvas's). */
export const CANVAS_SIDES = ["top", "right", "bottom", "left"] as const;
export type CanvasSide = (typeof CANVAS_SIDES)[number];
type CanvasEdgeEnd = "none" | "arrow";

/**
 * A point of an item's box, 0–1 across it (x) and down it (y): where an
 * edge's end meets the item, carried onto the outline its shape draws
 * (`./edges.ts`).
 */
export interface CanvasAnchor {
  readonly x: number;
  readonly y: number;
}

/**
 * How an edge runs between its ends (`./edges.ts`): JSON Canvas's curve
 * out along each end's side, a straight line, an arc, or an elbow along the
 * canvas's axes.
 */
export const CANVAS_ROUTES = ["curve", "straight", "arc", "elbow"] as const;
export type CanvasRoute = (typeof CANVAS_ROUTES)[number];

/** The head an edge's end wears: JSON Canvas's filled arrow, or one kb adds. */
export const CANVAS_HEADS = ["arrow", "open", "dot", "diamond", "bar"] as const;
export type CanvasHead = (typeof CANVAS_HEADS)[number];

export type KbLinkMode = "native" | "layout";

/** Binding from a canvas edge to a kb ref prop (directed: source → target). */
interface KbLink {
  mode: KbLinkMode;
  via: "prop";
  fieldId: string;
  sourceNodeId: string;
  targetNodeId: string;
  bindingId: string;
}

export interface CanvasNodeBase {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Elevation: the height of the item's base above the floor (the canvas
   * plane), in the same units as x and y. Absent is 0. In 3D it is a real
   * axis; from the top it orders painting (`paintOrder`).
   */
  z?: number;
  /**
   * How far the item rises from its base, in the same units. Absent or 0 is
   * flat: a card on its plane. Every item is a box — its footprint, `z` and
   * `depth` — that its shape fills (`./shapes.ts`); extruding an item sets
   * this and nothing else.
   */
  depth?: number;
  /**
   * How the item's box is turned about its centre, in degrees about x, then
   * y, then z (`./rotation.ts` owns the order). An absent angle is 0, and an
   * unturned item has no `rotation` at all.
   */
  rotation?: Partial<CanvasRotation>;
  color?: string;
  /**
   * What the item means: the store node it stands for. Any item may carry
   * one, whatever it looks like (`type`, `shape`); absent, the item is a
   * drawing with no node behind it.
   */
  nodeId?: string;
  /**
   * The group the item belongs to: a `group` item's id. A group carries its
   * members, nested to any depth (`./membership.ts`); one that names no
   * group, or would make the item its own member, is not honoured.
   */
  parent?: string;
  /** Where the item leads when it is followed (`CanvasItemLink`). Written only when set. */
  link?: CanvasItemLink;
  /**
   * Whether the item's face turns to the camera in 3D: a flat item stands up
   * square to the screen from where it lies, a solid shows its face in front
   * of it (`./shapes.ts` `faceStands`). Written only when set.
   */
  billboard?: boolean;
  /**
   * Whether the item is held where it is: no act that takes items — a
   * drag, a nudge, a turn or a scale, a resize, an arrangement, a group,
   * delete — takes it, and neither a marquee nor select-all gathers it
   * (`./membership.ts` `freeItems`). It is still pressed, inspected and
   * unlocked, and rides with a frame that holds it. Written only when set.
   */
  locked?: boolean;
  /**
   * How the item looks beyond its colour: its fill, outline, the size, face
   * and alignment of its words, and its opacity (`./style-fields.ts`; what
   * each means, and its default, `./style.ts`). Absent, every look is its
   * kind's default.
   */
  style?: CanvasStyleField;
  /** Unrecognized fields preserved for round-trip. */
  extra?: Record<string, unknown>;
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text";
  text: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
  type: "group";
  label?: string;
}

/** A card: a text card showing its node, live — layout only; text/tags render from the store. */
export interface CanvasKbNode extends CanvasNodeBase {
  type: "kb-node";
  nodeId: string;
}

/**
 * What fills a shape item's box (`./shapes.ts`): flat, its outline; with
 * depth, that outline carried up (a box, an elliptic cylinder, a prism of
 * any other), an ellipsoid or a cone. One of `SHAPE_KINDS`.
 */
export type CanvasShapeKind = (typeof SHAPE_KINDS)[number];

export interface CanvasShapeNode extends CanvasNodeBase {
  type: "shape";
  shape: CanvasShapeKind;
  label?: string;
}

/**
 * A JSON Canvas file item: a picture of the file at `file`. kb's are images
 * stored as assets, `assets/…` — the path `asset.upload` answers with and
 * markdown's `![](assets/…)` references — and its `subpath` round-trips as
 * an unknown field.
 */
export interface CanvasFileNode extends CanvasNodeBase {
  type: "file";
  file: string;
}

/**
 * Whether a file item's `file` is a picture kb draws: one of its own assets
 * (`assets/…`), an image by its extension. Any other file is shown by its
 * path and never fetched — a document naming a picture elsewhere would make
 * every viewer, and every export, fetch it, and in 3D its cross-origin
 * pixels would taint the face's canvas. The page and the SVG export both ask
 * this, by kb's one rule for its media (`@kb/model` `asset.ts`).
 */
export function isPictureFile(file: string): boolean {
  return isAssetPath(file) && mediaKindFromHref(file) === "image";
}

/**
 * A line drawn through points, kb's own item type: a line, or an arrow when
 * its ends wear heads. Its points are anchors of its box (0–1 across and
 * down it, `CanvasAnchor`), so it moves, resizes and turns as its box does.
 * Closed, its last point joins its first and it may be filled.
 */
export interface CanvasPathNode extends CanvasNodeBase {
  type: "path";
  /** At least two, in the order the line runs. */
  points: readonly CanvasAnchor[];
  closed?: boolean;
  /** The head each end wears; absent, none. */
  fromHead?: CanvasHead;
  toHead?: CanvasHead;
  /** Drawn by hand: its line runs smoothly through its points (`smoothThrough`), never straight. */
  freehand?: boolean;
  /** A highlighter's stroke: wide, translucent, and behind what lies with it (`itemPaint`, `paintOrder`). */
  highlight?: boolean;
}

/** Opaque passthrough for types kb does not read. */
interface CanvasUnknownNode extends CanvasNodeBase {
  type: string;
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasGroupNode
  | CanvasKbNode
  | CanvasShapeNode
  | CanvasFileNode
  | CanvasPathNode
  | CanvasLinkNode
  | CanvasUnknownNode;

export function isKbNode(n: CanvasNode): n is CanvasKbNode {
  return n.type === "kb-node" && "nodeId" in n;
}

export function isTextNode(n: CanvasNode): n is CanvasTextNode {
  return n.type === "text" && "text" in n;
}

export function isGroupNode(n: CanvasNode): n is CanvasGroupNode {
  return n.type === "group" && !("text" in n);
}

export function isShapeNode(n: CanvasNode): n is CanvasShapeNode {
  return n.type === "shape" && "shape" in n;
}

export function isFileNode(n: CanvasNode): n is CanvasFileNode {
  return n.type === "file" && "file" in n;
}

export function isPathNode(n: CanvasNode): n is CanvasPathNode {
  return n.type === "path" && "points" in n;
}

/** Every shape an item may fill its box with (`CANVAS_SHAPES`), as the document writes it. */
const SHAPE_KINDS = [
  "rect",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "star",
  "cloud",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-down",
  "check-box",
  "sphere",
  "cone",
] as const;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasSide;
  fromEnd?: CanvasEdgeEnd;
  toNode: string;
  toSide?: CanvasSide;
  toEnd?: CanvasEdgeEnd;
  color?: string;
  label?: string;
  kbLink?: KbLink;
  /**
   * Where each end meets its item, precisely; absent, its side's middle.
   * The side nearest an anchor is written beside it, the coarse form other
   * JSON Canvas readers keep (`./edges.ts` `withEnd`).
   */
  fromAnchor?: CanvasAnchor;
  toAnchor?: CanvasAnchor;
  /** How it runs between its ends; absent, JSON Canvas's curve. */
  route?: CanvasRoute;
  /**
   * How far an arc's middle stands off the straight line, to the left of
   * the way it runs (negative: to the right), or how far an elbow's middle
   * run is moved off centre, in canvas units. Absent, an arc bows a fifth
   * of the way across and an elbow turns halfway.
   */
  bend?: number;
  /**
   * Which head an end wears when its `fromEnd`/`toEnd` says it wears one;
   * absent, JSON Canvas's arrow (`./edges.ts` `withHead`).
   */
  fromHead?: CanvasHead;
  toHead?: CanvasHead;
  /** kb's looks: an edge draws its `dash`, `size` and `opacity` (`./style.ts`). */
  style?: CanvasStyleField;
  extra?: Record<string, unknown>;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /**
   * Items and edges kb cannot read at all — no id or kind, a box that is not
   * numbers, an edge without its ends — kept as written and written back
   * after the ones it reads, so no edit of the rest loses them.
   */
  unread?: { readonly nodes: readonly unknown[]; readonly edges: readonly unknown[] };
  extra?: Record<string, unknown>;
}

export const EMPTY_CANVAS_DOC: CanvasDoc = Object.freeze({
  nodes: [],
  edges: [],
});

const ENDS = ["none", "arrow"] as const;
/** kb's optional numeric item fields, written as no field at 0 (`withNumber`). */
type ItemNumber = "z" | "depth";

const AXES = ["x", "y", "z"] as const;

/**
 * A `rotation` as written: an object of angles about x, y and z, each a
 * finite number or absent. Anything else is a value this version cannot
 * read, and stays an unknown field.
 */
function parseRotation(raw: unknown): Partial<CanvasRotation> | undefined {
  if (!isRecord(raw)) return undefined;
  const angles: { x?: number; y?: number; z?: number } = {};
  for (const [key, value] of Object.entries(raw)) {
    const axis = AXES.find((a) => a === key);
    const angle = finite(value);
    if (axis === undefined || angle === undefined) return undefined;
    angles[axis] = angle;
  }
  return angles;
}

function parseKbLink(raw: unknown): KbLink | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.via !== "prop") return undefined;
  if (raw.mode !== "native" && raw.mode !== "layout") return undefined;
  if (
    typeof raw.fieldId !== "string" ||
    typeof raw.sourceNodeId !== "string" ||
    typeof raw.targetNodeId !== "string" ||
    typeof raw.bindingId !== "string"
  ) {
    return undefined;
  }
  return {
    mode: raw.mode,
    via: "prop",
    fieldId: raw.fieldId,
    sourceNodeId: raw.sourceNodeId,
    targetNodeId: raw.targetNodeId,
    bindingId: raw.bindingId,
  };
}

/** An item's optional fields, every kind's: JSON Canvas's colour, then kb's. */
type ItemField =
  | ItemNumber
  | "rotation"
  | "color"
  | "nodeId"
  | "parent"
  | "link"
  | "billboard"
  | "locked"
  | "style";

const ITEM_FIELDS: FieldCodecs<CanvasNodeBase, ItemField> = {
  z: { read: finite },
  depth: { read: finite },
  rotation: { read: parseRotation, write: (rotation) => ({ ...rotation }) },
  color: { read: text },
  nodeId: { read: text },
  parent: { read: text },
  link: { read: parseItemLink, write: (link) => ({ ...link }) },
  billboard: { read: bool },
  locked: { read: bool },
  style: { read: parseStyleField, write: emitStyleField },
};

/**
 * A line's points as written: at least two anchors of its box; anything
 * else is unreadable. What the format reads and every write checks a
 * line's points by (`withLine`).
 */
export function parseLinePoints(raw: unknown): CanvasAnchor[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const points: CanvasAnchor[] = [];
  for (const point of raw) {
    const anchor = parseAnchor(point);
    if (anchor === undefined) return undefined;
    points.push(anchor);
  }
  return points;
}

/** What every item is: its id, its kind, and the box it takes up. */
type ItemBox = Pick<CanvasNodeBase, "id" | "type" | "x" | "y" | "width" | "height">;

/** JSON Canvas's box, each with what an absent one is. */
const BOX_DEFAULTS = { x: 0, y: 0, width: 240, height: 80 } as const;
const BOX_KEYS: ReadonlySet<string> = new Set(["id", "type", ...Object.keys(BOX_DEFAULTS)]);

/**
 * An item's box as written, or undefined when kb cannot place it: no id or
 * type, or a position or size that is not a finite number. Such a record
 * is kept as written, unread (`CanvasDoc.unread`).
 */
function readBox(raw: Record<string, unknown>): ItemBox | undefined {
  if (typeof raw.id !== "string" || typeof raw.type !== "string") return undefined;
  const box: ItemBox = { id: raw.id, type: raw.type, ...BOX_DEFAULTS };
  for (const key of ["x", "y", "width", "height"] as const) {
    if (raw[key] === undefined) continue;
    const value = finite(raw[key]);
    if (value === undefined) return undefined;
    box[key] = value;
  }
  return box;
}

/**
 * What an item of one kind reads beyond every item's fields: its own
 * fields, and the item they make. `read` answers undefined when a field
 * the kind cannot be without is unreadable, which leaves the item one of a
 * kind kb does not know, every key it holds beyond the box kept as written.
 */
interface ItemKind {
  /** The keys this kind reads itself. */
  readonly keys: ReadonlySet<string>;
  readonly read: (
    raw: Record<string, unknown>,
    item: CanvasNodeBase,
  ) => { readonly node: CanvasNode; readonly extra?: Record<string, unknown> } | undefined;
  readonly write: (node: CanvasNode, out: Record<string, unknown>) => void;
}

/**
 * A kind from its field table: `required` names the fields it cannot be
 * without (an absent one takes `build`'s default, an unreadable one leaves
 * the item a kind kb does not know); every other field it reads is optional,
 * kept unread when kb cannot read it.
 */
function itemKind<N extends CanvasNode, K extends keyof N & string>(
  codecs: FieldCodecs<N, K>,
  required: readonly K[],
  is: (node: CanvasNode) => node is N,
  build: (item: CanvasNodeBase, fields: Partial<Pick<N, K>>) => N | undefined,
): ItemKind {
  const keys: ReadonlySet<string> = new Set(fieldKeys(codecs));
  return {
    keys,
    read: (raw, item) => {
      const fields: Partial<Pick<N, K>> = {};
      const others = new Set(Object.keys(raw).filter((key) => !keys.has(key)));
      const extra = readFields(codecs, raw, fields, others);
      if (extra !== undefined && required.some((key) => Object.hasOwn(extra, key)))
        return undefined;
      const node = build(item, fields);
      return node === undefined ? undefined : { node, ...(extra ? { extra } : {}) };
    },
    write: (node, out) => {
      if (is(node)) writeFields(codecs, node, out);
    },
  };
}

const anyHead = (raw: unknown) => oneOf(CANVAS_HEADS, raw);

/** The kinds kb reads, by `type`; any other is kept as written beyond its box and item fields. */
const ITEM_KINDS: Readonly<Record<string, ItemKind>> = {
  text: itemKind<CanvasTextNode, "text">(
    { text: { read: text } },
    ["text"],
    isTextNode,
    (item, f) => ({
      ...item,
      type: "text",
      text: f.text ?? "",
    }),
  ),
  group: itemKind<CanvasGroupNode, "label">(
    { label: { read: text } },
    [],
    isGroupNode,
    (item, f) => ({
      ...item,
      type: "group",
      ...f,
    }),
  ),
  // A card's node is every item's `nodeId`; a card cannot be without one.
  "kb-node": itemKind<CanvasKbNode, never>({}, [], isKbNode, (item) =>
    item.nodeId === undefined ? undefined : { ...item, type: "kb-node", nodeId: item.nodeId },
  ),
  shape: itemKind<CanvasShapeNode, "shape" | "label">(
    { shape: { read: (raw) => oneOf(SHAPE_KINDS, raw) }, label: { read: text } },
    ["shape"],
    isShapeNode,
    (item, f) => ({ ...item, ...f, type: "shape", shape: f.shape ?? "rect" }),
  ),
  link: itemKind<CanvasLinkNode, "url">(
    { url: { read: text } },
    ["url"],
    isLinkNode,
    (item, f) => ({
      ...item,
      type: "link",
      url: f.url ?? "",
    }),
  ),
  file: itemKind<CanvasFileNode, "file">(
    { file: { read: text } },
    ["file"],
    isFileNode,
    (item, f) => ({
      ...item,
      type: "file",
      file: f.file ?? "",
    }),
  ),
  path: itemKind<
    CanvasPathNode,
    "points" | "closed" | "fromHead" | "toHead" | "freehand" | "highlight"
  >(
    {
      points: { read: parseLinePoints, write: (points) => points.map(({ x, y }) => ({ x, y })) },
      closed: { read: bool },
      fromHead: { read: anyHead },
      toHead: { read: anyHead },
      freehand: { read: bool },
      highlight: { read: bool },
    },
    ["points"],
    isPathNode,
    (item, { points, ...f }) =>
      points === undefined ? undefined : { ...item, ...f, type: "path", points },
  ),
};

/** The kind `type` names, when kb reads it (a type is never one of an object's own names). */
const kindOf = (type: string): ItemKind | undefined =>
  Object.hasOwn(ITEM_KINDS, type) ? ITEM_KINDS[type] : undefined;

/** Every item's fields read from `raw` beyond `own`, and what of the rest kb cannot read. */
function readItem(raw: Record<string, unknown>, box: ItemBox, own: ReadonlySet<string>) {
  const fields: Partial<Pick<CanvasNodeBase, ItemField>> = {};
  const extra = readFields(ITEM_FIELDS, raw, fields, new Set([...BOX_KEYS, ...own]));
  return { item: { ...box, ...fields }, extra };
}

/** Unread keys from two readers as one record, or none. */
const joined = (a?: Record<string, unknown>, b?: Record<string, unknown>) =>
  a === undefined && b === undefined ? undefined : { ...a, ...b };

/** An item read, or undefined when kb cannot place it (kept unread by the document). */
function parseNode(raw: unknown): CanvasNode | undefined {
  if (!isRecord(raw)) return undefined;
  const box = readBox(raw);
  if (box === undefined) return undefined;
  const kind = kindOf(box.type);
  if (kind !== undefined) {
    const { item, extra } = readItem(raw, box, kind.keys);
    const read = kind.read(raw, item);
    if (read !== undefined) {
      const unread = joined(extra, read.extra);
      return unread === undefined ? read.node : { ...read.node, extra: unread };
    }
  }
  // A kind kb does not know, or one it cannot read: every key beyond the box kept.
  const { item, extra } = readItem(raw, box, new Set());
  return extra === undefined ? item : { ...item, extra };
}

/** An anchor as written: an object of just `x` and `y`, each from 0 to 1. */
function parseAnchor(raw: unknown): CanvasAnchor | undefined {
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "x" && key !== "y")) {
    return undefined;
  }
  const [x, y] = [finite(raw.x), finite(raw.y)];
  if (x === undefined || y === undefined || x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  return { x, y };
}

/** An edge's optional fields: JSON Canvas's, then kb's. */
type EdgeField = Exclude<keyof CanvasEdge, "id" | "fromNode" | "toNode" | "extra">;

const EDGE_FIELDS: FieldCodecs<CanvasEdge, EdgeField> = {
  fromSide: { read: (raw) => oneOf(CANVAS_SIDES, raw) },
  toSide: { read: (raw) => oneOf(CANVAS_SIDES, raw) },
  fromEnd: { read: (raw) => oneOf(ENDS, raw) },
  toEnd: { read: (raw) => oneOf(ENDS, raw) },
  color: { read: text },
  label: { read: text },
  kbLink: { read: parseKbLink },
  fromAnchor: { read: parseAnchor, write: ({ x, y }) => ({ x, y }) },
  toAnchor: { read: parseAnchor, write: ({ x, y }) => ({ x, y }) },
  route: { read: (raw) => oneOf(CANVAS_ROUTES, raw) },
  bend: { read: finite },
  fromHead: { read: (raw) => oneOf(CANVAS_HEADS, raw) },
  toHead: { read: (raw) => oneOf(CANVAS_HEADS, raw) },
  style: { read: parseStyleField, write: emitStyleField },
};

const EDGE_OWN_KEYS: ReadonlySet<string> = new Set(["id", "fromNode", "toNode"]);

/** An edge read, or undefined when it names no id or ends (kept unread by the document). */
function parseEdge(raw: unknown): CanvasEdge | undefined {
  if (
    !isRecord(raw) ||
    typeof raw.id !== "string" ||
    typeof raw.fromNode !== "string" ||
    typeof raw.toNode !== "string"
  ) {
    return undefined;
  }
  const edge: CanvasEdge = {
    id: raw.id,
    fromNode: raw.fromNode,
    toNode: raw.toNode,
  };
  const extra = readFields(EDGE_FIELDS, raw, edge, EDGE_OWN_KEYS);
  if (extra) edge.extra = extra;
  return edge;
}

function emitNode(n: CanvasNode): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
  };
  writeFields(ITEM_FIELDS, n, out);
  kindOf(n.type)?.write(n, out);
  return writeUnread(out, n.extra);
}

function emitEdge(e: CanvasEdge): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: e.id,
    fromNode: e.fromNode,
    toNode: e.toNode,
  };
  return writeUnread(writeFields(EDGE_FIELDS, e, out), e.extra);
}

const DOC_OWN_KEYS: ReadonlySet<string> = new Set(["nodes", "edges"]);

/** What `raw` holds beyond `own`, the keys the reader reads itself, or undefined for nothing. */
function unknownKeys(
  raw: Record<string, unknown>,
  own: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const extra = Object.fromEntries(
    Object.entries(raw).filter(([key, value]) => !own.has(key) && value !== undefined),
  );
  return Object.keys(extra).length > 0 ? extra : undefined;
}

/** Each of `list`'s entries read by `read`, and those it could not, as written. */
function readEach<T>(list: unknown, read: (raw: unknown) => T | undefined) {
  const known: T[] = [];
  const unread: unknown[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const parsed = read(raw);
    if (parsed === undefined) unread.push(raw);
    else known.push(parsed);
  }
  return { known, unread };
}

/** Parse a JSON Canvas document from a string or object. Throws on invalid JSON. */
export function parseCanvasDoc(input: unknown): CanvasDoc {
  const raw: unknown =
    typeof input === "string" ? (input.trim() === "" ? {} : JSON.parse(input)) : input;
  if (!isRecord(raw)) {
    throw new Error("canvas doc must be an object");
  }
  const nodes = readEach(raw.nodes, parseNode);
  const edges = readEach(raw.edges, parseEdge);
  const extra = unknownKeys(raw, DOC_OWN_KEYS);
  const unread =
    nodes.unread.length === 0 && edges.unread.length === 0
      ? undefined
      : { nodes: nodes.unread, edges: edges.unread };
  return {
    nodes: nodes.known,
    edges: edges.known,
    ...(unread ? { unread } : {}),
    ...(extra ? { extra } : {}),
  };
}

export function stringifyCanvasDoc(doc: CanvasDoc): string {
  const out: Record<string, unknown> = {
    nodes: [...doc.nodes.map(emitNode), ...(doc.unread?.nodes ?? [])],
    edges: [...doc.edges.map(emitEdge), ...(doc.unread?.edges ?? [])],
  };
  return JSON.stringify(writeUnread(out, doc.extra));
}

/** An item's elevation: the height of its base above the floor, 0 when it has none. */
export function canvasElevation(node: CanvasNode): number {
  return node.z ?? 0;
}

/**
 * `node` with numeric field `key` at `value`. 0 is written as no value at
 * all, so an item that comes back to 0 leaves the document as it was before
 * the field existed, and a value set here supersedes one this version could
 * not read.
 */
function withNumber<N extends CanvasNode>(node: N, key: ItemNumber, value: number): N {
  const next = { ...node };
  if (value === 0) delete next[key];
  else next[key] = value;
  return dropExtra(next, key);
}

/** `node` with its base at elevation `z`; back on the floor it carries no `z`. */
export function withElevation<N extends CanvasNode>(node: N, z: number): N {
  return withNumber(node, "z", z);
}

/** How far an item rises from its base: 0, flat, when it has no depth (or a negative one). */
export function canvasDepth(node: CanvasNode): number {
  return Math.max(0, node.depth ?? 0);
}

/** `node` extruded to `depth` (never below 0); flat again, it carries no `depth`. */
export function withDepth<N extends CanvasNode>(node: N, depth: number): N {
  return withNumber(node, "depth", Math.max(0, depth));
}

/** How an item is turned, every angle given (0 for an absent one). */
export function canvasRotation(node: CanvasNode): CanvasRotation {
  return boxRotation(node);
}

/**
 * `node` turned to `rotation`, each angle within (-180, 180]. An angle of 0
 * is written as no angle, and an unturned item carries no `rotation`, so an
 * item turned back leaves the document as it was; a turn set here supersedes
 * one this version could not read.
 */
export function withRotation<N extends CanvasNode>(node: N, rotation: CanvasRotation): N {
  const angles: { x?: number; y?: number; z?: number } = {};
  for (const axis of AXES) {
    const angle = normalizeDegrees(rotation[axis]);
    if (angle !== 0) angles[axis] = angle;
  }
  const next = { ...node };
  if (Object.keys(angles).length === 0) delete next.rotation;
  else next.rotation = angles;
  return dropExtra(next, "rotation");
}

/**
 * `node` belonging to group `parent`, or to none; one set here supersedes a
 * value this version could not read.
 */
export function withParent<N extends CanvasNode>(node: N, parent: string | undefined): N {
  const next = { ...node };
  if (parent === undefined) delete next.parent;
  else next.parent = parent;
  return dropExtra(next, "parent");
}

/** An item's switches: fields that are on or absent, never written `false`. */
export type CanvasItemFlag = "billboard" | "locked";

/**
 * `node` with switch `flag` on or off: on, it is written `true`; off, the
 * item carries no such field. A value set here supersedes one this version
 * could not read.
 */
export function withFlag<N extends CanvasNode>(node: N, flag: CanvasItemFlag, on: boolean): N {
  const next = { ...node };
  if (on) next[flag] = true;
  else delete next[flag];
  return dropExtra(next, flag);
}

/** The height of an item's top surface: what is stacked on it stands there (`boxTop`). */
export function canvasTop(node: CanvasNode): number {
  return boxTop(node);
}

/** Immutable patch helpers. */
export function upsertCanvasNode(doc: CanvasDoc, node: CanvasNode): CanvasDoc {
  const idx = doc.nodes.findIndex((n) => n.id === node.id);
  const nodes = [...doc.nodes];
  if (idx >= 0) nodes[idx] = node;
  else nodes.push(node);
  return { ...doc, nodes };
}

export function upsertCanvasEdge(doc: CanvasDoc, edge: CanvasEdge): CanvasDoc {
  const idx = doc.edges.findIndex((e) => e.id === edge.id);
  const edges = [...doc.edges];
  if (idx >= 0) edges[idx] = edge;
  else edges.push(edge);
  return { ...doc, edges };
}

export function removeCanvasEdge(doc: CanvasDoc, edgeId: string): CanvasDoc {
  return { ...doc, edges: doc.edges.filter((e) => e.id !== edgeId) };
}

/**
 * Pure render-time check: does the source still carry the bound ref prop?
 * Edges are drawings — this never mutates the canvas document.
 */
export function isNativeEdgeBound(
  edge: CanvasEdge,
  lookup: (nodeId: string, fieldId: string) => ReadonlyArray<{ t: string; v: unknown }> | undefined,
): boolean {
  const link = edge.kbLink;
  if (!link || link.mode !== "native" || !link.fieldId) return true;
  const props = lookup(link.sourceNodeId, link.fieldId) ?? [];
  return props.some((p) => p.t === "ref" && p.v === link.targetNodeId);
}
