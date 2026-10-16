/**
 * JSON Canvas 1.0 document helpers + kbLink edge bindings.
 * Spec: https://jsoncanvas.org/spec/1.0/
 *
 * Unknown node types and extra fields round-trip (forward compatible). kb's
 * own extension fields are typed here: `nodeId`, `z`, `depth`,
 * `rotation`, `parent` and `style` on any item, `shape` on a shape item,
 * `kbLink`, the anchors, `route`, `bend`, the heads and `style` on an edge,
 * and `camera` on the document (`./camera.ts`). The format, as agents write
 * it, is DESIGN.md → Canvas documents.
 */
import { boxRotation, boxTop } from "./box.ts";
import { emitCanvasCamera, parseCanvasCamera, type CanvasCamera } from "./camera.ts";
import { dropExtra } from "./extra.ts";
import {
  finite,
  isRecord,
  oneOf,
  readFields,
  text,
  writeFields,
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

interface CanvasNodeBase {
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
  /**
   * Whether the item's face turns to the camera in 3D: a flat item stands up
   * square to the screen from where it lies, a solid shows its face in front
   * of it (`./shapes.ts` `faceStands`). Written only when set.
   */
  billboard?: boolean;
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
 * depth, a box, an elliptic cylinder, a prism, an ellipsoid or a cone.
 */
export type CanvasShapeKind = "rect" | "ellipse" | "diamond" | "sphere" | "cone";

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

/** Opaque passthrough for link/future types. */
interface CanvasUnknownNode extends CanvasNodeBase {
  type: string;
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasGroupNode
  | CanvasKbNode
  | CanvasShapeNode
  | CanvasFileNode
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

const SHAPE_KINDS = [
  "rect",
  "ellipse",
  "diamond",
  "sphere",
  "cone",
] as const satisfies readonly CanvasShapeKind[];

function normalizeShapeKind(raw: unknown): CanvasShapeKind {
  return oneOf(SHAPE_KINDS, raw) ?? "rect";
}

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
  /** How the canvas is looked at; absent is 2D. View state, not content (`./camera.ts`). */
  camera?: CanvasCamera;
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

function asNum(v: unknown, fallback = 0): number {
  return finite(v) ?? fallback;
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
type ItemField = ItemNumber | "rotation" | "color" | "nodeId" | "parent" | "billboard" | "style";

const ITEM_FIELDS: FieldCodecs<CanvasNodeBase, ItemField> = {
  z: { read: finite },
  depth: { read: finite },
  rotation: { read: parseRotation, write: (rotation) => ({ ...rotation }) },
  color: { read: text },
  nodeId: { read: text },
  parent: { read: text },
  billboard: { read: (raw) => (typeof raw === "boolean" ? raw : undefined) },
  style: { read: parseStyleField, write: emitStyleField },
};

/** What an item's kind reads itself: its box, and the fields only some kinds carry. */
const ITEM_OWN_KEYS: ReadonlySet<string> = new Set([
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "text",
  "label",
  "shape",
  "file",
]);

function parseNode(raw: unknown): CanvasNode | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.type !== "string") {
    return null;
  }
  const fields: Partial<Pick<CanvasNodeBase, ItemField>> = {};
  const extra = readFields(ITEM_FIELDS, raw, fields, ITEM_OWN_KEYS);
  const base = {
    id: raw.id,
    type: raw.type,
    x: asNum(raw.x),
    y: asNum(raw.y),
    width: asNum(raw.width, 240),
    height: asNum(raw.height, 80),
    ...fields,
    ...(extra ? { extra } : {}),
  };
  if (raw.type === "text") {
    return {
      ...base,
      type: "text",
      text: typeof raw.text === "string" ? raw.text : "",
    };
  }
  if (raw.type === "group") {
    return {
      ...base,
      type: "group",
      ...(typeof raw.label === "string" ? { label: raw.label } : {}),
    };
  }
  if (raw.type === "kb-node") {
    if (typeof raw.nodeId !== "string") return null;
    return { ...base, type: "kb-node", nodeId: raw.nodeId };
  }
  if (raw.type === "shape") {
    return {
      ...base,
      type: "shape",
      shape: normalizeShapeKind(raw.shape),
      ...(typeof raw.label === "string" ? { label: raw.label } : {}),
    };
  }
  if (raw.type === "file") {
    return { ...base, type: "file", file: typeof raw.file === "string" ? raw.file : "" };
  }
  // link / future — opaque passthrough
  return base;
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

function parseEdge(raw: unknown): CanvasEdge | null {
  if (
    !isRecord(raw) ||
    typeof raw.id !== "string" ||
    typeof raw.fromNode !== "string" ||
    typeof raw.toNode !== "string"
  ) {
    return null;
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
  // `CanvasUnknownNode.type` is `string`, so `type === "text"` does not
  // discriminate the union — the guards this module already exports do.
  if (isTextNode(n)) out.text = n.text;
  if (isGroupNode(n) && n.label !== undefined) out.label = n.label;
  if (isShapeNode(n)) {
    out.shape = n.shape;
    if (n.label !== undefined) out.label = n.label;
  }
  if (isFileNode(n)) out.file = n.file;
  if (n.extra) Object.assign(out, n.extra);
  return out;
}

function emitEdge(e: CanvasEdge): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: e.id,
    fromNode: e.fromNode,
    toNode: e.toNode,
  };
  writeFields(EDGE_FIELDS, e, out);
  if (e.extra) Object.assign(out, e.extra);
  return out;
}

/** The document's optional fields: how it is looked at (`./camera.ts`). */
const DOC_FIELDS: FieldCodecs<CanvasDoc, "camera"> = {
  camera: { read: parseCanvasCamera, write: emitCanvasCamera },
};

const DOC_OWN_KEYS: ReadonlySet<string> = new Set(["nodes", "edges"]);

/** Parse a JSON Canvas document from a string or object. Throws on invalid JSON. */
export function parseCanvasDoc(input: unknown): CanvasDoc {
  const raw: unknown =
    typeof input === "string" ? (input.trim() === "" ? {} : JSON.parse(input)) : input;
  if (!isRecord(raw)) {
    throw new Error("canvas doc must be an object");
  }
  const nodes: CanvasNode[] = [];
  if (Array.isArray(raw.nodes)) {
    for (const n of raw.nodes) {
      const parsed = parseNode(n);
      if (parsed) nodes.push(parsed);
    }
  }
  const edges: CanvasEdge[] = [];
  if (Array.isArray(raw.edges)) {
    for (const e of raw.edges) {
      const parsed = parseEdge(e);
      if (parsed) edges.push(parsed);
    }
  }
  const fields: Partial<Pick<CanvasDoc, "camera">> = {};
  const extra = readFields(DOC_FIELDS, raw, fields, DOC_OWN_KEYS);
  return { nodes, edges, ...fields, ...(extra ? { extra } : {}) };
}

export function stringifyCanvasDoc(doc: CanvasDoc): string {
  const out: Record<string, unknown> = {
    nodes: doc.nodes.map(emitNode),
    edges: doc.edges.map(emitEdge),
  };
  if (doc.extra) Object.assign(out, doc.extra);
  return JSON.stringify(writeFields(DOC_FIELDS, doc, out));
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

/**
 * `node` with its face turned to the camera, or not: set, it is written
 * `true`; cleared, it carries no `billboard`. A value set here supersedes one
 * this version could not read.
 */
export function withBillboard<N extends CanvasNode>(node: N, on: boolean): N {
  const next = { ...node };
  if (on) next.billboard = true;
  else delete next.billboard;
  return dropExtra(next, "billboard");
}

/** The height of an item's top surface: what is stacked on it stands there (`boxTop`). */
export function canvasTop(node: CanvasNode): number {
  return boxTop(node);
}

/**
 * `doc` looked at through `camera` (view state only; no item changes). The
 * same document comes back when nothing changes, so reference-equal history
 * stays a no-op. Clearing keeps a camera this version could not read; setting
 * one replaces it.
 */
export function withCanvasCamera(doc: CanvasDoc, camera: CanvasCamera | undefined): CanvasDoc {
  if (camera === undefined) {
    if (doc.camera === undefined) return doc;
    const cleared = { ...doc };
    delete cleared.camera;
    return cleared;
  }
  const unread = doc.extra !== undefined && "camera" in doc.extra;
  if (doc.camera === camera && !unread) return doc;
  return dropExtra({ ...doc, camera }, "camera");
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
