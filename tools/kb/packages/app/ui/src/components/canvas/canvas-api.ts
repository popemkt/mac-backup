/**
 * Client helpers for canvas doc IO.
 *
 * Logseq model: edges are drawings. Native bind is a one-shot prop write via
 * ext.canvas.tx.apply; afterward the edge does not track/own the prop.
 * Bound vs unbound is computed at render time only (no reconciler writes).
 */
import {
  browserHost,
  isSysPrefixed,
  type KbIndex,
  logError,
  type OutlineNode,
  type PropValue,
  resolveAllowedRefIds,
  resolveFieldType,
  type SchemaIndex,
} from "@/sdk";
import { ulid } from "ulid";
import {
  EMPTY_CANVAS_DOC,
  isNativeEdgeBound,
  parseCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
  type CanvasEdge,
} from "@kb/canvas";
import { SYSTEM_IDS, typeRefsOf } from "@kb/model";

export function readCanvasDoc(node: OutlineNode | undefined): CanvasDoc {
  if (!node) return { nodes: [], edges: [] };
  const raw = node.props[SYSTEM_IDS.canvasField]?.[0];
  if (!raw || raw.t !== "str" || typeof raw.v !== "string") {
    return { nodes: [], edges: [] };
  }
  try {
    return parseCanvasDoc(raw.v);
  } catch {
    return { nodes: [], edges: [] };
  }
}

export function listCanvasNodes(nodes: Map<string, OutlineNode>): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const n of nodes.values()) {
    const tagged = typeRefsOf(n).includes(SYSTEM_IDS.canvasTag);
    if (tagged) out.push(n);
  }
  return out.toSorted((a, b) => a.text.localeCompare(b.text));
}

function propLookupFromStore(
  nodes: Map<string, OutlineNode>,
): (nodeId: string, fieldId: string) => ReadonlyArray<{ t: string; v: unknown }> | undefined {
  return (nodeId, fieldId) => {
    const n = nodes.get(nodeId);
    return n?.props[fieldId];
  };
}

/** `#canvas` nodes as the Canvases sidebar section lists them. */
export function listCanvasNavItems(
  nodes: Map<string, OutlineNode>,
): Array<{ readonly id: string; readonly label: string }> {
  return listCanvasNodes(nodes).map((n) => ({
    id: n.id,
    label: n.text || "Untitled canvas",
  }));
}

/** Render-time: native edge whose prop is still present. */
export function edgePropPresent(edge: CanvasEdge, nodes: Map<string, OutlineNode>): boolean {
  return isNativeEdgeBound(edge, propLookupFromStore(nodes));
}

/**
 * Live-sync canvas JSON from the store on rev bumps.
 * When busy (drag/dirty), skip — never clobber in-progress local edits.
 * No orphan pruning / no persist-back.
 */
export function syncDocOnRev(
  canvasId: string,
  nodes: Map<string, OutlineNode>,
  opts: {
    applyLocal: (doc: CanvasDoc) => void;
    isBusy: () => boolean;
  },
): void {
  if (opts.isBusy()) return;
  opts.applyLocal(readCanvasDoc(nodes.get(canvasId)));
}

export function hasPropRef(
  nodes: ReadonlyMap<string, OutlineNode>,
  sourceId: string,
  fieldId: string,
  targetId: string,
): boolean {
  const props = nodes.get(sourceId)?.props[fieldId] ?? [];
  return props.some((p) => p.t === "ref" && p.v === targetId);
}

/** One-shot native bind: setProps only if the triple is not already present. */
export function planNativeBind(
  nodes: ReadonlyMap<string, OutlineNode>,
  sourceId: string,
  fieldId: string,
  targetId: string,
): { setProps?: { field: string; value: PropValue }[]; skip: boolean } {
  if (hasPropRef(nodes, sourceId, fieldId, targetId)) {
    return { skip: true };
  }
  return {
    skip: false,
    setProps: [{ field: fieldId, value: { t: "ref", v: targetId } }],
  };
}

export function isValidNativeTarget(
  fieldId: string,
  targetNodeId: string,
  schema: SchemaIndex,
  queryDb: KbIndex | null,
): boolean {
  const field = schema.get(fieldId);
  if (!field) return false;
  if (resolveFieldType(field) !== "ref") return false;
  const allowed = resolveAllowedRefIds(field, schema, queryDb);
  if (allowed === null) return true;
  return allowed.has(targetNodeId);
}

/**
 * Persist canvas JSON (+ optional one-shot prop ops) atomically on the server.
 * A single node.update cannot reproduce this action: it replaces the canvas
 * document while optionally updating a second node in the same transaction.
 * The WebSocket echo is therefore the only local graph write.
 */
export async function persistCanvasDoc(
  canvasId: string,
  doc: CanvasDoc,
  opts?: {
    propTargetId?: string;
    setProps?: { field: string; value: PropValue }[];
    unsetProps?: { field: string; value?: unknown }[];
  },
): Promise<boolean> {
  const receipt = await browserHost().invoke("ext.canvas.tx.apply", {
    canvasId,
    doc: stringifyCanvasDoc(doc),
    propTargetId: opts?.propTargetId,
    setProps: opts?.setProps,
    unsetProps: opts?.unsetProps,
  });
  if (receipt.status === "failed") {
    logError("[kb/canvas] tx.apply failed:", receipt.message);
    return false;
  }
  return true;
}

export async function createCanvasNode(text = "Untitled canvas"): Promise<string | null> {
  const id = ulid();
  const docStr = stringifyCanvasDoc(EMPTY_CANVAS_DOC);
  const receipt = await browserHost().invoke("node.add", {
    text,
    id,
    tags: [SYSTEM_IDS.canvasTag],
    props: [{ field: SYSTEM_IDS.canvasField, value: { t: "str", v: docStr } }],
  });
  if (receipt.status === "failed") {
    logError("[kb/canvas] create failed:", receipt.message);
    return null;
  }
  return id;
}

/** Ref fields only (fieldType=ref), excluding sys.*. */
export function listRefFields(
  nodes: Map<string, OutlineNode>,
): { id: string; name: string; isRef: boolean }[] {
  const out: { id: string; name: string; isRef: boolean }[] = [];
  for (const n of nodes.values()) {
    if (!typeRefsOf(n).includes(SYSTEM_IDS.field)) continue;
    // DISPLAY: the native-bind field menu lists a user's own ref fields.
    if (isSysPrefixed(n.id)) continue;
    if (resolveFieldType(n) !== "ref") continue;
    out.push({ id: n.id, name: n.text, isRef: true });
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name));
}
