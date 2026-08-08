/**
 * Client helpers for canvas doc IO via ext.canvas.tx.apply / node.update.
 */
import { ulid } from "ulid";
import { postAction } from "@/api/action";
import {
  EMPTY_CANVAS_DOC,
  parseCanvasDoc,
  reconcileCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
  type PropLookup,
} from "@kb/canvas";
import { SYSTEM_IDS, type PropValue } from "@/lib/types";
import type { OutlineNode } from "@/lib/types";
import type { WireNode } from "@kb/protocol";
import { useOutlineStore } from "@/stores/outline.store";

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

export function listCanvasNodes(
  nodes: Map<string, OutlineNode>,
): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const n of nodes.values()) {
    const tagged = (n.props[SYSTEM_IDS.typeField] ?? []).some(
      (v) => v.t === "ref" && v.v === SYSTEM_IDS.canvasTag,
    );
    if (tagged) out.push(n);
  }
  return out.sort((a, b) => a.text.localeCompare(b.text));
}

export function propLookupFromStore(
  nodes: Map<string, OutlineNode>,
): PropLookup {
  return (nodeId, fieldId) => {
    const n = nodes.get(nodeId);
    return n?.props[fieldId] as
      | ReadonlyArray<{ t: string; v: unknown }>
      | undefined;
  };
}

/** Reconcile on load / WS rev — drop orphaned native edges; persist if changed. */
export function reconcileAndMaybePersist(
  canvasId: string,
  doc: CanvasDoc,
  nodes: Map<string, OutlineNode>,
): CanvasDoc {
  const { doc: next, dropped } = reconcileCanvasDoc(
    doc,
    propLookupFromStore(nodes),
  );
  if (dropped.length > 0) {
    console.info(
      `[kb/canvas] dropped orphaned native edges on ${canvasId}:`,
      dropped,
    );
    void persistCanvasDoc(canvasId, next);
  }
  return next;
}

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
    console.error("[kb/canvas] tx.apply failed:", receipt.message);
    return false;
  }
  // Optimistic local merge — WS will confirm.
  const store = useOutlineStore.getState();
  const wire = store.wireNodes.find((n) => n.id === canvasId);
  if (wire) {
    const upserts: WireNode[] = [
      {
        ...wire,
        props: {
          ...wire.props,
          [SYSTEM_IDS.canvasField]: [
            { t: "str", v: stringifyCanvasDoc(doc) },
          ],
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
          const nextList = list.filter(
            (pv) => JSON.stringify(pv) !== JSON.stringify(u.value),
          );
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

export async function createCanvasNode(
  text = "Untitled canvas",
): Promise<string | null> {
  const id = ulid();
  const docStr = stringifyCanvasDoc(EMPTY_CANVAS_DOC);
  const receipt = await postAction("node.add", {
    text,
    id,
    tags: [SYSTEM_IDS.canvasTag],
    props: [
      { field: SYSTEM_IDS.canvasField, value: { t: "str", v: docStr } },
    ],
  });
  if (receipt.status === "failed") {
    console.error("[kb/canvas] create failed:", receipt.message);
    return null;
  }
  return id;
}

/** List field nodes with fieldType=ref (preferred) plus all field defs. */
export function listRefFields(
  nodes: Map<string, OutlineNode>,
): { id: string; name: string; isRef: boolean }[] {
  const out: { id: string; name: string; isRef: boolean }[] = [];
  for (const n of nodes.values()) {
    const isField = (n.props[SYSTEM_IDS.typeField] ?? []).some(
      (v) => v.t === "ref" && v.v === SYSTEM_IDS.field,
    );
    if (!isField) continue;
    if (n.id.startsWith("sys.")) continue;
    const ft = n.props[SYSTEM_IDS.fieldTypeField]?.[0];
    const isRef = ft?.t === "str" && ft.v === "ref";
    out.push({ id: n.id, name: n.text, isRef });
  }
  return out.sort((a, b) => {
    if (a.isRef !== b.isRef) return a.isRef ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
