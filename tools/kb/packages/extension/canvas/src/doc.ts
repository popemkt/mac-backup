/**
 * JSON Canvas 1.0 document helpers + kbLink edge bindings.
 * Spec: https://jsoncanvas.org/spec/1.0/
 *
 * Unknown node types and extra fields round-trip (forward compatible). kb's
 * own extension fields are typed here: `nodeId`, `shape` and `z` on an item,
 * `kbLink` on an edge, and `camera` on the document (`./camera.ts`). The
 * format, as agents write it, is DESIGN.md → Canvas documents.
 */
import { emitCanvasCamera, parseCanvasCamera, type CanvasCamera } from "./camera.ts";

export type CanvasSide = "top" | "right" | "bottom" | "left";
type CanvasEdgeEnd = "none" | "arrow";

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
   * Depth, toward the viewer, in the same units as x and y. Absent is 0, the
   * canvas plane. In 3D it is a real axis; face-on it only orders painting
   * (`paintOrder`).
   */
  z?: number;
  color?: string;
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

/** Live kb node card — layout only; text/tags render from the store. */
export interface CanvasKbNode extends CanvasNodeBase {
  type: "kb-node";
  nodeId: string;
}

/** Freeform draw.io-style shape (JSON-only; no store node). */
export type CanvasShapeKind = "rect" | "ellipse" | "diamond";

export interface CanvasShapeNode extends CanvasNodeBase {
  type: "shape";
  shape: CanvasShapeKind;
  label?: string;
}

/** Opaque passthrough for file/link/future types. */
interface CanvasUnknownNode extends CanvasNodeBase {
  type: string;
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasGroupNode
  | CanvasKbNode
  | CanvasShapeNode
  | CanvasUnknownNode;

export function isKbNode(n: CanvasNode): n is CanvasKbNode {
  return n.type === "kb-node" && "nodeId" in n;
}

export function isTextNode(n: CanvasNode): n is CanvasTextNode {
  return n.type === "text" && "text" in n;
}

export function isGroupNode(n: CanvasNode): n is CanvasGroupNode {
  return n.type === "group" && !("nodeId" in n) && !("text" in n);
}

export function isShapeNode(n: CanvasNode): n is CanvasShapeNode {
  return n.type === "shape" && "shape" in n;
}

const SHAPE_KINDS = ["rect", "ellipse", "diamond"] as const;

/**
 * Membership that narrows. A `Set<string>.has()` proves nothing to the type
 * system, which is why every caller used to re-assert the literal it had just
 * checked; the allowed values are the type, so read them back from the list.
 */
function oneOf<T extends string>(allowed: readonly T[], raw: unknown): T | undefined {
  return allowed.find((value) => value === raw);
}

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

const SIDES = ["top", "right", "bottom", "left"] as const;
const ENDS = ["none", "arrow"] as const;
const KNOWN_NODE_KEYS = new Set([
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "z",
  "color",
  "text",
  "label",
  "nodeId",
  "shape",
]);
const KNOWN_EDGE_KEYS = new Set([
  "id",
  "fromNode",
  "toNode",
  "fromSide",
  "toSide",
  "fromEnd",
  "toEnd",
  "color",
  "label",
  "kbLink",
]);
const KNOWN_DOC_KEYS = new Set(["nodes", "edges"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function collectExtra(
  raw: Record<string, unknown>,
  known: Set<string>,
): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) extra[k] = v;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
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

function parseNode(raw: unknown): CanvasNode | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.type !== "string") {
    return null;
  }
  const extra = collectExtra(raw, KNOWN_NODE_KEYS);
  const base = {
    id: raw.id,
    type: raw.type,
    x: asNum(raw.x),
    y: asNum(raw.y),
    width: asNum(raw.width, 240),
    height: asNum(raw.height, 80),
    ...(typeof raw.z === "number" && Number.isFinite(raw.z) ? { z: raw.z } : {}),
    ...(typeof raw.color === "string" ? { color: raw.color } : {}),
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
  // file / link / future — opaque passthrough
  return base;
}

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
  const fromSide = oneOf(SIDES, raw.fromSide);
  if (fromSide !== undefined) edge.fromSide = fromSide;
  const toSide = oneOf(SIDES, raw.toSide);
  if (toSide !== undefined) edge.toSide = toSide;
  const fromEnd = oneOf(ENDS, raw.fromEnd);
  if (fromEnd !== undefined) edge.fromEnd = fromEnd;
  const toEnd = oneOf(ENDS, raw.toEnd);
  if (toEnd !== undefined) edge.toEnd = toEnd;
  if (typeof raw.color === "string") edge.color = raw.color;
  if (typeof raw.label === "string") edge.label = raw.label;
  const kbLink = parseKbLink(raw.kbLink);
  if (kbLink) edge.kbLink = kbLink;
  const extra = collectExtra(raw, KNOWN_EDGE_KEYS);
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
  if (n.z !== undefined) out.z = n.z;
  if (n.color !== undefined) out.color = n.color;
  // `CanvasUnknownNode.type` is `string`, so `type === "text"` does not
  // discriminate the union — the guards this module already exports do.
  if (isTextNode(n)) out.text = n.text;
  if (isGroupNode(n) && n.label !== undefined) out.label = n.label;
  if (isKbNode(n)) out.nodeId = n.nodeId;
  if (isShapeNode(n)) {
    out.shape = n.shape;
    if (n.label !== undefined) out.label = n.label;
  }
  if (n.extra) Object.assign(out, n.extra);
  return out;
}

function emitEdge(e: CanvasEdge): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: e.id,
    fromNode: e.fromNode,
    toNode: e.toNode,
  };
  if (e.fromSide !== undefined) out.fromSide = e.fromSide;
  if (e.toSide !== undefined) out.toSide = e.toSide;
  if (e.fromEnd !== undefined) out.fromEnd = e.fromEnd;
  if (e.toEnd !== undefined) out.toEnd = e.toEnd;
  if (e.color !== undefined) out.color = e.color;
  if (e.label !== undefined) out.label = e.label;
  if (e.kbLink) out.kbLink = e.kbLink;
  if (e.extra) Object.assign(out, e.extra);
  return out;
}

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
  const camera = parseCanvasCamera(raw.camera);
  // A camera this version cannot read stays an unknown field, untouched.
  const extra = collectExtra(raw, camera ? new Set([...KNOWN_DOC_KEYS, "camera"]) : KNOWN_DOC_KEYS);
  return {
    nodes,
    edges,
    ...(camera ? { camera } : {}),
    ...(extra ? { extra } : {}),
  };
}

export function stringifyCanvasDoc(doc: CanvasDoc): string {
  const out: Record<string, unknown> = {
    nodes: doc.nodes.map(emitNode),
    edges: doc.edges.map(emitEdge),
  };
  if (doc.extra) Object.assign(out, doc.extra);
  if (doc.camera) out.camera = emitCanvasCamera(doc.camera);
  return JSON.stringify(out);
}

/** An item's depth: 0, the canvas plane, when it has none. */
export function canvasDepth(node: CanvasNode): number {
  return node.z ?? 0;
}

/**
 * `node` at depth `z`. Depth 0 is written as no depth at all, so an item
 * that comes back to the plane leaves the document as it was before 3D.
 */
export function withDepth<N extends CanvasNode>(node: N, z: number): N {
  const next = { ...node };
  if (z === 0) delete next.z;
  else next.z = z;
  return next;
}

/**
 * Items back to front: by depth, and at one depth in document order, which
 * bring-to-front and send-to-back rearrange. Every projection paints and
 * hit-tests in this order, so face-on a raised item covers a lower one.
 */
export function paintOrder(nodes: readonly CanvasNode[]): CanvasNode[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .toSorted((a, b) => canvasDepth(a.node) - canvasDepth(b.node) || a.index - b.index)
    .map(({ node }) => node);
}

/** `doc` looked at through `camera` (view state only; no item changes). */
export function withCanvasCamera(doc: CanvasDoc, camera: CanvasCamera | undefined): CanvasDoc {
  const next: CanvasDoc = { ...doc };
  if (camera === undefined) delete next.camera;
  else next.camera = camera;
  // A camera this version could not read gives way to the one set here.
  if (next.extra && "camera" in next.extra) {
    const rest = Object.fromEntries(Object.entries(next.extra).filter(([k]) => k !== "camera"));
    if (Object.keys(rest).length > 0) next.extra = rest;
    else delete next.extra;
  }
  return next;
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
