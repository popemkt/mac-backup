/**
 * Client helpers for canvas doc IO.
 *
 * Logseq model: edges are drawings. Native bind is a one-shot prop write via
 * ext.canvas.tx.apply; afterward the edge does not track/own the prop.
 * Bound vs unbound is computed at render time only (no reconciler writes).
 */
import { ulid } from "ulid";
import { postAction } from "@/api/action";
import {
  EMPTY_CANVAS_DOC,
  isNativeEdgeBound,
  parseCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
  type CanvasEdge,
} from "@kb/canvas";
import { resolveAllowedRefIds, resolveFieldType } from "@/lib/field-type";
import { typeRefsOf } from "@kb/model";
import { SYSTEM_IDS, isSysPrefixed, type PropValue, type OutlineNode } from "@/lib/types";
import type { WireNode } from "@kb/contracts";
import { useOutlineStore } from "@/stores/outline.store";
import { logError } from "@/lib/log";

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

export function propLookupFromStore(
  nodes: Map<string, OutlineNode>,
): (nodeId: string, fieldId: string) => ReadonlyArray<{ t: string; v: unknown }> | undefined {
  return (nodeId, fieldId) => {
    const n = nodes.get(nodeId);
    return n?.props[fieldId];
  };
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
  nodes: Map<string, OutlineNode>,
  sourceId: string,
  fieldId: string,
  targetId: string,
): boolean {
  const props = nodes.get(sourceId)?.props[fieldId] ?? [];
  return props.some((p) => p.t === "ref" && p.v === targetId);
}

/** One-shot native bind: setProps only if the triple is not already present. */
export function planNativeBind(
  nodes: Map<string, OutlineNode>,
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
  nodes: Map<string, OutlineNode>,
  queryDb: ReturnType<typeof useOutlineStore.getState>["queryDb"],
): boolean {
  const field = nodes.get(fieldId);
  if (!field) return false;
  if (resolveFieldType(field) !== "ref") return false;
  const allowed = resolveAllowedRefIds(field, nodes, queryDb);
  if (allowed === null) return true;
  return allowed.has(targetNodeId);
}

/**
 * Persist canvas JSON (+ optional one-shot prop ops) via ext.canvas.tx.apply.
 * UI never writes props through node.update — this is the only semantic path.
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
  const receipt = await postAction("ext.canvas.tx.apply", {
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
  const store = useOutlineStore.getState();
  const wire = store.wireNodes.find((n) => n.id === canvasId);
  if (wire) {
    const upserts: WireNode[] = [
      {
        ...wire,
        props: {
          ...wire.props,
          [SYSTEM_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(doc) }],
        },
        updatedAt: new Date().toISOString(),
      },
    ];
    if (opts?.propTargetId) {
      const src = store.wireNodes.find((n) => n.id === opts.propTargetId);
      if (src) {
        const props: WireNode["props"] = { ...src.props };
        for (const u of opts.unsetProps ?? []) {
          const list = props[u.field] ?? [];
          const nextList = list.filter((pv) => JSON.stringify(pv) !== JSON.stringify(u.value));
          if (nextList.length === 0) delete props[u.field];
          else props[u.field] = nextList;
        }
        for (const s of opts.setProps ?? []) {
          const list = props[s.field] ?? [];
          props[s.field] = [...list, s.value];
        }
        upserts.push({
          ...src,
          props,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    store.applyTx(upserts, []);
  }
  return true;
}

export async function createCanvasNode(text = "Untitled canvas"): Promise<string | null> {
  const id = ulid();
  const docStr = stringifyCanvasDoc(EMPTY_CANVAS_DOC);
  const at = new Date().toISOString();
  const store = useOutlineStore.getState();
  const optimistic: WireNode = {
    id,
    text,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.canvasTag }],
      [SYSTEM_IDS.canvasField]: [{ t: "str", v: docStr }],
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  store.applyTx([optimistic], []);

  const receipt = await postAction("node.add", {
    text,
    id,
    tags: [SYSTEM_IDS.canvasTag],
    props: [{ field: SYSTEM_IDS.canvasField, value: { t: "str", v: docStr } }],
  });
  if (receipt.status === "failed") {
    logError("[kb/canvas] create failed:", receipt.message);
    store.applyTx([], [id]);
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
