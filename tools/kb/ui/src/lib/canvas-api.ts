/**
 * Client helpers for canvas doc IO via ext.canvas.tx.apply / node.update.
 */
import { ulid } from "ulid";
import { postAction } from "@/api/action";
import {
  EMPTY_CANVAS_DOC,
  parseCanvasDoc,
  pruneOrphanEdges,
  reconcileCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
  type PropLookup,
} from "@kb/canvas";
import {
  resolveAllowedRefIds,
  resolveFieldType,
} from "@/lib/field-type";
import { SYSTEM_IDS, type PropValue } from "@/lib/types";
import type { OutlineNode } from "@/lib/types";
import type { WireNode } from "@kb/protocol";
import { useOutlineStore } from "@/stores/outline.store";

const RECONCILE_PERSIST_MS = 400;

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

export interface ReconcileOptions {
  /** Current local editor doc — prune orphans onto THIS, never store snapshot. */
  getLocalDoc: () => CanvasDoc;
  /** Apply pruned local doc into React state. */
  applyLocal: (doc: CanvasDoc) => void;
  /** True while drag/dirty — skip store→doc overwrite; still may schedule prune. */
  isBusy: () => boolean;
  /** Optional: accept foreign host doc when not busy. */
  onForeignDoc?: (doc: CanvasDoc) => void;
}

let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let pendingOrphans: { canvasId: string; ids: string[] } | null = null;

/**
 * On rev: if busy, only collect orphan edge ids from local doc and debounce
 * a minimal prune persist. If idle, accept foreign host doc then prune.
 */
export function reconcileOnRev(
  canvasId: string,
  nodes: Map<string, OutlineNode>,
  opts: ReconcileOptions,
): void {
  const lookup = propLookupFromStore(nodes);
  const local = opts.getLocalDoc();
  const { doc: normalized, dropped, demoted } = reconcileCanvasDoc(
    local,
    lookup,
  );

  if (!opts.isBusy()) {
    const foreign = readCanvasDoc(nodes.get(canvasId));
    // Merge: take foreign layout only when idle; re-apply orphan prune on it.
    const { doc: foreignNorm, dropped: d2 } = reconcileCanvasDoc(
      foreign,
      lookup,
    );
    const merged = demoted.length > 0 || dropped.length > 0
      ? pruneOrphanEdges(
          foreignNorm.nodes.length > 0 || foreignNorm.edges.length > 0
            ? foreignNorm
            : normalized,
          [...dropped, ...d2],
        )
      : foreignNorm.nodes.length > 0 || foreignNorm.edges.length > 0
        ? foreignNorm
        : normalized;
    // Re-demote empty-field natives on the chosen doc
    const final = reconcileCanvasDoc(merged, lookup).doc;
    opts.onForeignDoc?.(final);
    opts.applyLocal(final);
    const orphans = [...new Set([...dropped, ...d2])];
    if (orphans.length > 0) scheduleOrphanPersist(canvasId, orphans, opts);
    return;
  }

  // Busy: keep local layout; demote empty-field natives in memory; schedule
  // orphan drops as a delta on whatever docRef is at flush time.
  if (demoted.length > 0 || dropped.length > 0) {
    opts.applyLocal(normalized);
  }
  if (dropped.length > 0) {
    scheduleOrphanPersist(canvasId, dropped, opts);
  }
}

function scheduleOrphanPersist(
  canvasId: string,
  ids: string[],
  opts: ReconcileOptions,
): void {
  pendingOrphans = {
    canvasId,
    ids: [...new Set([...(pendingOrphans?.ids ?? []), ...ids])],
  };
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    const pending = pendingOrphans;
    pendingOrphans = null;
    if (!pending || pending.ids.length === 0) return;
    if (opts.isBusy()) {
      // Still busy — reschedule.
      scheduleOrphanPersist(pending.canvasId, pending.ids, opts);
      return;
    }
    const base = opts.getLocalDoc();
    const next = pruneOrphanEdges(base, pending.ids);
    if (next === base) return;
    console.info(
      `[kb/canvas] pruned orphaned native edges on ${pending.canvasId}:`,
      pending.ids,
    );
    opts.applyLocal(next);
    void persistCanvasDoc(pending.canvasId, next);
  }, RECONCILE_PERSIST_MS);
}

/** @deprecated use reconcileOnRev — kept for tests of pure prune helpers. */
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

export function hasPropRef(
  nodes: Map<string, OutlineNode>,
  sourceId: string,
  fieldId: string,
  targetId: string,
): boolean {
  const props = nodes.get(sourceId)?.props[fieldId] ?? [];
  return props.some((p) => p.t === "ref" && p.v === targetId);
}

/** Build setProps/unsetProps for an idempotent native bind. */
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
  const at = new Date().toISOString();
  const store = useOutlineStore.getState();
  // Optimistic local upsert so /canvas/:id resolves before WS.
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
    props: [
      { field: SYSTEM_IDS.canvasField, value: { t: "str", v: docStr } },
    ],
  });
  if (receipt.status === "failed") {
    console.error("[kb/canvas] create failed:", receipt.message);
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
    const isField = (n.props[SYSTEM_IDS.typeField] ?? []).some(
      (v) => v.t === "ref" && v.v === SYSTEM_IDS.field,
    );
    if (!isField) continue;
    if (n.id.startsWith("sys.")) continue;
    if (resolveFieldType(n) !== "ref") continue;
    out.push({ id: n.id, name: n.text, isRef: true });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Test helper — clear debounce timers between cases. */
export function resetReconcileTimers(): void {
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = null;
  pendingOrphans = null;
}
