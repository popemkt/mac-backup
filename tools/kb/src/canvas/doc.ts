/**
 * JSON Canvas 1.0 document helpers + kbLink edge bindings.
 * Spec: https://jsoncanvas.org/spec/1.0/
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
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
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

export type CanvasNode = CanvasTextNode | CanvasGroupNode | CanvasKbNode;

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
  /** Optional kb relationship binding. */
  kbLink?: KbLink;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const EMPTY_CANVAS_DOC: CanvasDoc = Object.freeze({
  nodes: [],
  edges: [],
}) as CanvasDoc;

const SIDES = new Set(["top", "right", "bottom", "left"]);
const ENDS = new Set(["none", "arrow"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
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
  const base = {
    id: raw.id,
    x: asNum(raw.x),
    y: asNum(raw.y),
    width: asNum(raw.width, 240),
    height: asNum(raw.height, 80),
    ...(typeof raw.color === "string" ? { color: raw.color } : {}),
  };
  if (raw.type === "text") {
    return { ...base, type: "text", text: typeof raw.text === "string" ? raw.text : "" };
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
  return null;
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
  return edge;
}

/** Parse a JSON Canvas document from a string or object. Throws on invalid JSON. */
export function parseCanvasDoc(input: string | unknown): CanvasDoc {
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
  return { nodes, edges };
}

export function stringifyCanvasDoc(doc: CanvasDoc): string {
  return JSON.stringify({ nodes: doc.nodes, edges: doc.edges });
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

export type PropLookup = (
  nodeId: string,
  fieldId: string,
) => ReadonlyArray<{ t: string; v: unknown }> | undefined;

/**
 * Drop native kbLink edges whose bound prop value no longer exists.
 * Layout-mode edges are kept regardless of prop state.
 */
export function reconcileCanvasDoc(
  doc: CanvasDoc,
  lookup: PropLookup,
): { doc: CanvasDoc; dropped: string[] } {
  const dropped: string[] = [];
  const edges = doc.edges.filter((edge) => {
    const link = edge.kbLink;
    if (!link || link.mode !== "native") return true;
    const props = lookup(link.sourceNodeId, link.fieldId) ?? [];
    const stillBound = props.some(
      (p) => p.t === "ref" && p.v === link.targetNodeId,
    );
    if (!stillBound) {
      dropped.push(edge.id);
      return false;
    }
    return true;
  });
  if (dropped.length === 0) return { doc, dropped };
  return { doc: { ...doc, edges }, dropped };
}
