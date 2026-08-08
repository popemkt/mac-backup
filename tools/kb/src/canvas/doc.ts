/**
 * JSON Canvas 1.0 document helpers + kbLink edge bindings.
 * Spec: https://jsoncanvas.org/spec/1.0/
 *
 * Unknown node types and extra fields round-trip (forward compatible).
 */

export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CanvasEdgeEnd = "none" | "arrow";

export type KbLinkMode = "native" | "layout";

/** Binding from a canvas edge to a kb ref prop (directed: source → target). */
export interface KbLink {
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

/** Opaque passthrough for file/link/future types. */
export interface CanvasUnknownNode extends CanvasNodeBase {
  type: string;
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasGroupNode
  | CanvasKbNode
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
  extra?: Record<string, unknown>;
}

export const EMPTY_CANVAS_DOC: CanvasDoc = Object.freeze({
  nodes: [],
  edges: [],
}) as CanvasDoc;

const SIDES = new Set(["top", "right", "bottom", "left"]);
const ENDS = new Set(["none", "arrow"]);
const KNOWN_NODE_KEYS = new Set([
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "color",
  "text",
  "label",
  "nodeId",
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
  // file / link / future — opaque passthrough
  return base as CanvasUnknownNode;
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
  if (typeof raw.fromSide === "string" && SIDES.has(raw.fromSide)) {
    edge.fromSide = raw.fromSide as CanvasSide;
  }
  if (typeof raw.toSide === "string" && SIDES.has(raw.toSide)) {
    edge.toSide = raw.toSide as CanvasSide;
  }
  if (typeof raw.fromEnd === "string" && ENDS.has(raw.fromEnd)) {
    edge.fromEnd = raw.fromEnd as CanvasEdgeEnd;
  }
  if (typeof raw.toEnd === "string" && ENDS.has(raw.toEnd)) {
    edge.toEnd = raw.toEnd as CanvasEdgeEnd;
  }
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
  if (n.color !== undefined) out.color = n.color;
  if (n.type === "text") out.text = (n as CanvasTextNode).text;
  if (n.type === "group" && (n as CanvasGroupNode).label !== undefined) {
    out.label = (n as CanvasGroupNode).label;
  }
  if (n.type === "kb-node") out.nodeId = (n as CanvasKbNode).nodeId;
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
export function parseCanvasDoc(input: string | unknown): CanvasDoc {
  const raw: unknown =
    typeof input === "string"
      ? input.trim() === ""
        ? {}
        : JSON.parse(input)
      : input;
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
  const extra = collectExtra(raw, KNOWN_DOC_KEYS);
  return extra ? { nodes, edges, extra } : { nodes, edges };
}

export function stringifyCanvasDoc(doc: CanvasDoc): string {
  const out: Record<string, unknown> = {
    nodes: doc.nodes.map(emitNode),
    edges: doc.edges.map(emitEdge),
  };
  if (doc.extra) Object.assign(out, doc.extra);
  return JSON.stringify(out);
}

/** Immutable patch helpers. */
export function upsertCanvasNode(doc: CanvasDoc, node: CanvasNode): CanvasDoc {
  const idx = doc.nodes.findIndex((n) => n.id === node.id);
  const nodes = [...doc.nodes];
  if (idx >= 0) nodes[idx] = node;
  else nodes.push(node);
  return { ...doc, nodes };
}

export function removeCanvasNode(doc: CanvasDoc, nodeId: string): CanvasDoc {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== nodeId),
    edges: doc.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId),
  };
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

/** Drop edges that share a bindingId (native unlink). */
export function removeEdgesByBindingId(
  doc: CanvasDoc,
  bindingId: string,
): CanvasDoc {
  if (!bindingId) return doc;
  return {
    ...doc,
    edges: doc.edges.filter((e) => e.kbLink?.bindingId !== bindingId),
  };
}

/** Dedupe native edges that share the same (source, field, target) triple. */
export function dedupeNativeEdgesByTriple(doc: CanvasDoc): CanvasDoc {
  const seen = new Set<string>();
  const edges: CanvasEdge[] = [];
  for (const e of doc.edges) {
    const link = e.kbLink;
    if (link?.mode === "native" && link.fieldId) {
      const key = `${link.sourceNodeId}\0${link.fieldId}\0${link.targetNodeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    edges.push(e);
  }
  return edges.length === doc.edges.length ? doc : { ...doc, edges };
}

export type PropLookup = (
  nodeId: string,
  fieldId: string,
) => ReadonlyArray<{ t: string; v: unknown }> | undefined;

/**
 * Normalize + drop orphaned native kbLink edges.
 * - native + empty fieldId → demote to layout (never auto-drop)
 * - native with field whose prop value is gone → drop edge id
 * Layout-mode edges are kept regardless of prop state.
 */
export function reconcileCanvasDoc(
  doc: CanvasDoc,
  lookup: PropLookup,
): { doc: CanvasDoc; dropped: string[]; demoted: string[] } {
  const dropped: string[] = [];
  const demoted: string[] = [];
  const edges: CanvasEdge[] = [];

  for (const edge of doc.edges) {
    const link = edge.kbLink;
    if (!link || link.mode !== "native") {
      edges.push(edge);
      continue;
    }
    if (!link.fieldId) {
      demoted.push(edge.id);
      edges.push({
        ...edge,
        kbLink: { ...link, mode: "layout" },
      });
      continue;
    }
    const props = lookup(link.sourceNodeId, link.fieldId) ?? [];
    const stillBound = props.some(
      (p) => p.t === "ref" && p.v === link.targetNodeId,
    );
    if (!stillBound) {
      dropped.push(edge.id);
      continue;
    }
    edges.push(edge);
  }

  if (dropped.length === 0 && demoted.length === 0) {
    return { doc, dropped, demoted };
  }
  return { doc: { ...doc, edges }, dropped, demoted };
}

/** Apply orphan-edge drops as a minimal delta onto `base` (keeps base layout). */
export function pruneOrphanEdges(
  base: CanvasDoc,
  orphanEdgeIds: ReadonlySet<string> | readonly string[],
): CanvasDoc {
  const drop = orphanEdgeIds instanceof Set
    ? orphanEdgeIds
    : new Set(orphanEdgeIds);
  if (drop.size === 0) return base;
  const edges = base.edges.filter((e) => !drop.has(e.id));
  return edges.length === base.edges.length ? base : { ...base, edges };
}

/** Find orphan native edge ids on `doc` without mutating layout of other edges. */
export function findOrphanNativeEdgeIds(
  doc: CanvasDoc,
  lookup: PropLookup,
): string[] {
  const { dropped } = reconcileCanvasDoc(doc, lookup);
  return dropped;
}
