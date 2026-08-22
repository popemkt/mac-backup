import { create } from "zustand";
import type { QueryDb } from "@/ds/db";
import { buildQueryDb } from "@/ds/db";
import {
  loadExpandedIds,
  resolveProps,
  saveExpandedIds,
  searchNodes,
  wireToOutlineMap,
} from "@/lib/graph-view";
import { outlineInstanceKey } from "@/lib/instance-key";
import { isQueryNode } from "@/lib/query-node";
import { cloneWire, mergeTx } from "@/lib/tx";
import {
  collectVisibleInstances,
  neighborVisibleInstance,
  type VisibleInstance,
} from "@/lib/visible-instances";
import { WORKSPACE_ROOT_ID, isSysPrefixed, type NodeMap, type OutlineNode } from "@/lib/types";
import type { InverseTx } from "@/actions/plan";
import type { WireNode } from "@kb/protocol";

export type { VisibleInstance };

const HISTORY_LIMIT = 50;

export interface UndoEntry {
  inv: InverseTx;
  /** Compensating registry actions (best-effort remote undo). */
  actions: Array<{ id: string; input: unknown }>;
}

export interface ActivateOpts {
  /**
   * Viewport x-coordinate to preserve across vertical navigation (r1 D11).
   * Consumed by NodeContent after caret placement.
   */
  x?: number | null;
}

interface OutlineState {
  nodes: NodeMap;
  wireNodes: WireNode[];
  queryDb: QueryDb | null;
  rev: number;
  rootNodeId: string;
  homeRootId: string;
  /** Data-layer node id currently being edited. */
  activeNodeId: string | null;
  /** Render-instance key for the active editor (disambiguates duplicates). */
  activeInstanceKey: string | null;
  selectedNodeId: string | null;
  selectedInstanceKey: string | null;
  cursorPosition: number;
  loadSource: "api" | "fixtures" | null;
  loadError: string | null;
  /** Bumped on every activateNode so remounts re-place the caret. */
  focusSeq: number;
  /** Pending column-preservation target for the next activation (D11). */
  focusX: number | null;
  /** Session-minted transient node ids; empty ones prune on deactivate. */
  transientIds: Set<string>;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  hydrateFromWire: (nodes: WireNode[], rev: number, source: "api" | "fixtures") => void;
  /** Apply node-level delta (optimistic edits + WS tx). */
  applyTx: (upserts: WireNode[], deletes: string[], opts?: { rev?: number }) => void;
  /** Restore a prior wire snapshot (optimistic revert). */
  restoreSnapshot: (nodes: WireNode[], rev: number) => void;
  /** Full-snapshot resync (rev gap) that preserves zoom/selection/collapse. */
  refreshFromWire: (nodes: WireNode[], rev: number) => void;
  setRootNodeId: (id: string) => void;
  zoomTo: (id: string) => void;
  zoomHome: () => void;
  activateNode: (id: string, cursorPos?: number, instanceKey?: string, opts?: ActivateOpts) => void;
  deactivateNode: () => void;
  selectNode: (id: string | null, instanceKey?: string) => void;
  toggleCollapse: (id: string) => void;
  expandAllInScope: () => void;
  collapseAllInScope: () => void;
  expandAncestors: (id: string) => void;
  jumpToNode: (id: string) => void;
  search: (query: string) => Array<{ id: string; text: string }>;
  getVisibleInstances: () => VisibleInstance[];
  getVisibleNodes: () => string[];
  getPreviousVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getNextVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  /** @deprecated Prefer getPreviousVisibleInstance — ambiguous when nodeId repeats. */
  getPreviousVisibleNode: (id: string) => string | null;
  /** @deprecated Prefer getNextVisibleInstance — ambiguous when nodeId repeats. */
  getNextVisibleNode: (id: string) => string | null;
  getBreadcrumbs: () => Array<{ id: string; text: string }>;
  /** Register a session-minted transient node id (auto-prune candidate). */
  markTransient: (ids: string | string[]) => void;
  /** Push an undo entry (trims redo tail). */
  recordUndo: (entry: UndoEntry) => void;
  /** Pop undoStack → apply inverse; push forward entry onto redoStack. */
  applyUndo: () => UndoEntry | null;
  /** Pop redoStack → apply forward entry; push back onto undoStack. */
  applyRedo: () => UndoEntry | null;
}

function collectExpanded(nodes: NodeMap): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes.values()) {
    if (!n.collapsed && n.id !== WORKSPACE_ROOT_ID) ids.add(n.id);
  }
  return ids;
}

function collectSubtreeIds(nodeId: string, nodes: NodeMap, result: string[]): void {
  const node = nodes.get(nodeId);
  if (!node) return;
  result.push(nodeId);
  for (const childId of node.children) {
    collectSubtreeIds(childId, nodes, result);
  }
}

function scopeNodeIds(nodes: NodeMap, rootNodeId: string): string[] {
  const result: string[] = [];
  if (rootNodeId !== WORKSPACE_ROOT_ID) {
    const root = nodes.get(rootNodeId);
    if (!root) return result;
    for (const childId of root.children) {
      collectSubtreeIds(childId, nodes, result);
    }
    return result;
  }
  const workspace = nodes.get(WORKSPACE_ROOT_ID);
  if (!workspace) return result;
  for (const childId of workspace.children) {
    collectSubtreeIds(childId, nodes, result);
  }
  return result;
}

function isExpandableOutlineNode(node: OutlineNode, nodes: NodeMap): boolean {
  if (node.children.length > 0) return true;
  if (isQueryNode(node)) return true;
  return resolveProps(node, nodes).length > 0;
}

function resolveActivateKey(id: string, instanceKey: string | undefined, nodes: NodeMap): string {
  return instanceKey ?? outlineInstanceKey(id, nodes);
}

/**
 * Tana-style transient pruning (r1 §3.3): a session-minted node that never
 * received content and carries no structure is silently removed when focus
 * moves elsewhere. Pre-existing nodes are never pruned (data compat).
 */
function isPrunableTransient(
  node: OutlineNode | undefined,
  id: string,
  transientIds: Set<string>,
): boolean {
  if (!node || !transientIds.has(id)) return false;
  if (isSysPrefixed(id)) return false;
  if (node.text !== "") return false;
  if (node.children.length > 0) return false;
  return resolveProps(node, new Map()).length === 0;
}

export const useOutlineStore = create<OutlineState>((set, get) => {
  /**
   * Prune the outgoing active row when it is an empty session transient
   * (r1 §3.3 auto-prune). nextId = incoming focus target; null when focus
   * leaves the outline entirely.
   */
  function pruneOutgoingTransient(nextId: string | null): void {
    const st = get();
    const out = st.activeNodeId;
    if (!out || out === nextId) return;
    const node = st.nodes.get(out);
    if (!isPrunableTransient(node, out, st.transientIds)) return;
    const nextWire = mergeTx(st.wireNodes, [], [out]);
    const expanded = collectExpanded(st.nodes);
    for (const id of loadExpandedIds()) expanded.add(id);
    const nextTransient = new Set(st.transientIds);
    nextTransient.delete(out);
    set({
      wireNodes: nextWire,
      nodes: wireToOutlineMap(nextWire, expanded),
      queryDb: buildQueryDb(nextWire, st.rev),
      transientIds: nextTransient,
    });
  }

  /** Apply an inverse/forward tx; return the opposite-direction entry. */
  function applyHistoryEntry(entry: UndoEntry): UndoEntry {
    const st = get();
    const touched = new Set<string>([...entry.inv.upserts.map((u) => u.id), ...entry.inv.deletes]);
    const postWire = mergeTx(st.wireNodes, entry.inv.upserts, entry.inv.deletes);
    const forwardUpserts: WireNode[] = [];
    for (const n of postWire) {
      if (touched.has(n.id)) forwardUpserts.push(cloneWire(n));
    }
    const forwardDeletes = entry.inv.upserts
      .map((u) => u.id)
      .filter((id) => !postWire.some((n) => n.id === id));
    const expanded = collectExpanded(st.nodes);
    for (const id of loadExpandedIds()) expanded.add(id);
    const survives = (id: string | null): boolean =>
      id !== null && postWire.some((n) => n.id === id);
    const selectedNodeId = survives(st.selectedNodeId) ? st.selectedNodeId : null;
    set({
      wireNodes: postWire,
      nodes: wireToOutlineMap(postWire, expanded),
      queryDb: buildQueryDb(postWire, st.rev),
      selectedNodeId,
      selectedInstanceKey: selectedNodeId ? st.selectedInstanceKey : null,
      activeNodeId: null,
      activeInstanceKey: null,
    });
    return {
      inv: { upserts: forwardUpserts, deletes: forwardDeletes },
      actions: [],
    };
  }

  return {
    nodes: new Map(),
    wireNodes: [],
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    cursorPosition: 0,
    loadSource: null,
    loadError: null,
    focusSeq: 0,
    focusX: null,
    transientIds: new Set<string>(),
    undoStack: [],
    redoStack: [],

    hydrateFromWire: (wireNodes, rev, source) => {
      const expanded = loadExpandedIds();
      const nodes = wireToOutlineMap(wireNodes, expanded);
      const queryDb = buildQueryDb(wireNodes, rev);
      set({
        wireNodes,
        nodes,
        queryDb,
        rev,
        loadSource: source,
        loadError: null,
        rootNodeId: WORKSPACE_ROOT_ID,
        homeRootId: WORKSPACE_ROOT_ID,
        transientIds: new Set<string>(),
        undoStack: [],
        redoStack: [],
      });
    },

    applyTx: (upserts, deletes, opts) => {
      const prev = get();
      const nextWire = mergeTx(prev.wireNodes, upserts, deletes);
      const expanded = collectExpanded(prev.nodes);
      for (const id of loadExpandedIds()) expanded.add(id);
      const nodes = wireToOutlineMap(nextWire, expanded);
      const nextRev = opts?.rev ?? prev.rev;
      // Deleted nodes must not remain the zoom root / selection.
      const rootNodeId = nodes.has(prev.rootNodeId) ? prev.rootNodeId : prev.homeRootId;
      const selectedNodeId =
        prev.selectedNodeId && nodes.has(prev.selectedNodeId) ? prev.selectedNodeId : null;
      const activeNodeId =
        prev.activeNodeId && nodes.has(prev.activeNodeId) ? prev.activeNodeId : null;
      const transientIds = new Set<string>();
      for (const id of prev.transientIds) {
        if (nodes.has(id)) transientIds.add(id);
      }
      set({
        wireNodes: nextWire,
        nodes,
        queryDb: buildQueryDb(nextWire, nextRev),
        rev: nextRev,
        rootNodeId,
        selectedNodeId,
        selectedInstanceKey: selectedNodeId ? prev.selectedInstanceKey : null,
        activeNodeId,
        activeInstanceKey: activeNodeId ? prev.activeInstanceKey : null,
        transientIds,
      });
    },

    restoreSnapshot: (wireNodes, rev) => {
      const prev = get();
      // Never rewind rev: concurrent WS/refetch may have advanced past the
      // pre-optimistic baseline. Node payload may still roll back; rev must not.
      const nextRev = Math.max(prev.rev, rev);
      const expanded = collectExpanded(prev.nodes);
      for (const id of loadExpandedIds()) expanded.add(id);
      set({
        wireNodes,
        nodes: wireToOutlineMap(wireNodes, expanded),
        queryDb: buildQueryDb(wireNodes, nextRev),
        rev: nextRev,
      });
    },

    refreshFromWire: (wireNodes, rev) => {
      const prev = get();
      const expanded = collectExpanded(prev.nodes);
      const nodes = wireToOutlineMap(wireNodes, expanded);
      const queryDb = buildQueryDb(wireNodes, rev);
      const rootNodeId = nodes.has(prev.rootNodeId) ? prev.rootNodeId : prev.homeRootId;
      const selectedNodeId =
        prev.selectedNodeId && nodes.has(prev.selectedNodeId) ? prev.selectedNodeId : null;
      const activeNodeId =
        prev.activeNodeId && nodes.has(prev.activeNodeId) ? prev.activeNodeId : null;
      const transientIds = new Set<string>();
      for (const id of prev.transientIds) {
        if (nodes.has(id)) transientIds.add(id);
      }
      set({
        wireNodes,
        nodes,
        queryDb,
        rev,
        rootNodeId,
        selectedNodeId,
        selectedInstanceKey: selectedNodeId ? prev.selectedInstanceKey : null,
        activeNodeId,
        activeInstanceKey: activeNodeId ? prev.activeInstanceKey : null,
        transientIds,
      });
    },

    setRootNodeId: (id) => set({ rootNodeId: id }),

    zoomTo: (id) => {
      const { nodes } = get();
      if (!nodes.has(id)) return;
      pruneOutgoingTransient(null);
      const key = outlineInstanceKey(id, get().nodes);
      set({
        rootNodeId: id,
        selectedNodeId: id,
        selectedInstanceKey: key,
        activeNodeId: null,
        activeInstanceKey: null,
      });
    },

    zoomHome: () => {
      pruneOutgoingTransient(null);
      set({
        rootNodeId: get().homeRootId,
        selectedNodeId: null,
        selectedInstanceKey: null,
        activeNodeId: null,
        activeInstanceKey: null,
      });
    },

  activateNode: (id, cursorPos, instanceKey, opts) => {
    if (!get().nodes.has(id)) return;
    // System nodes are read-only at the DOM level: activation degrades to
    // selection so no caret ever enters their content (r1 D20).
    if (isSysPrefixed(id)) {
      pruneOutgoingTransient(id);
      const sysKey = resolveActivateKey(id, instanceKey, get().nodes);
      set({
        selectedNodeId: id,
        selectedInstanceKey: sysKey,
        activeNodeId: null,
        activeInstanceKey: null,
      });
      return;
    }
    // Tana transient rule: an empty session-minted node prunes the moment
    // focus moves to a different row (r1 §3.3).
    pruneOutgoingTransient(id);
      const { nodes } = get();
      const key = resolveActivateKey(id, instanceKey, nodes);
      set((s) => ({
        activeNodeId: id,
        activeInstanceKey: key,
        selectedNodeId: id,
        selectedInstanceKey: key,
        cursorPosition: cursorPos ?? 0,
        focusSeq: s.focusSeq + 1,
        focusX: opts?.x ?? null,
      }));
    },

    deactivateNode: () => {
      pruneOutgoingTransient(null);
      set({ activeNodeId: null, activeInstanceKey: null });
    },

    selectNode: (id, instanceKey) => {
      if (!id) {
        pruneOutgoingTransient(null);
        set({
          selectedNodeId: null,
          selectedInstanceKey: null,
          activeNodeId: null,
          activeInstanceKey: null,
        });
        return;
      }
      if (!get().nodes.has(id)) return;
      pruneOutgoingTransient(id);
      const { nodes } = get();
      const key = resolveActivateKey(id, instanceKey, nodes);
      set({
        selectedNodeId: id,
        selectedInstanceKey: key,
        activeNodeId: null,
        activeInstanceKey: null,
      });
    },

    toggleCollapse: (id) => {
      const { nodes } = get();
      const node = nodes.get(id);
      if (!node) return;
      const expandable = isExpandableOutlineNode(node, nodes);
      if (!expandable) return;
      const next = new Map(nodes);
      next.set(id, { ...node, collapsed: !node.collapsed });
      saveExpandedIds(collectExpanded(next));
      set({ nodes: next });
    },

    expandAllInScope: () => {
      const { nodes, rootNodeId } = get();
      const next = new Map(nodes);
      let changed = false;
      for (const id of scopeNodeIds(next, rootNodeId)) {
        const node = next.get(id);
        if (!node || !isExpandableOutlineNode(node, next)) continue;
        if (node.collapsed) {
          next.set(id, { ...node, collapsed: false });
          changed = true;
        }
      }
      if (!changed) return;
      saveExpandedIds(collectExpanded(next));
      set({ nodes: next });
    },

    collapseAllInScope: () => {
      const { nodes, rootNodeId } = get();
      const next = new Map(nodes);
      let changed = false;
      for (const id of scopeNodeIds(next, rootNodeId)) {
        const node = next.get(id);
        if (!node || !isExpandableOutlineNode(node, next)) continue;
        if (!node.collapsed) {
          next.set(id, { ...node, collapsed: true });
          changed = true;
        }
      }
      if (!changed) return;
      saveExpandedIds(collectExpanded(next));
      set({ nodes: next });
    },

    expandAncestors: (id) => {
      const { nodes } = get();
      const next = new Map(nodes);
      let current: OutlineNode | undefined = next.get(id);
      let changed = false;
      while (current?.parentId) {
        const parent = next.get(current.parentId);
        if (!parent) break;
        if (parent.collapsed) {
          next.set(parent.id, { ...parent, collapsed: false });
          changed = true;
        }
        current = parent;
      }
      if (changed) {
        saveExpandedIds(collectExpanded(next));
        set({ nodes: next });
      }
    },

    jumpToNode: (id) => {
      const { nodes, expandAncestors, activateNode } = get();
      if (!nodes.has(id) || id === WORKSPACE_ROOT_ID) return;
      expandAncestors(id);
      // Ensure zoom shows the node: if not under current root, go home
      const visible = get().getVisibleNodes();
      if (!visible.includes(id)) {
        set({ rootNodeId: WORKSPACE_ROOT_ID });
        get().expandAncestors(id);
      }
      const key = outlineInstanceKey(id, get().nodes);
      activateNode(id, 0, key);
      // scroll into view after paint — instance key beats bare nodeId
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-instance-key="${CSS.escape(key)}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },

    search: (query) => searchNodes(get().nodes, query),

    getVisibleInstances: () => {
      const { nodes, rootNodeId, queryDb } = get();
      return collectVisibleInstances(rootNodeId, nodes, queryDb);
    },

    getVisibleNodes: () =>
      get()
        .getVisibleInstances()
        .map((i) => i.nodeId),

    getPreviousVisibleInstance: (instanceKey) =>
      neighborVisibleInstance(get().getVisibleInstances(), instanceKey, -1),

    getNextVisibleInstance: (instanceKey) =>
      neighborVisibleInstance(get().getVisibleInstances(), instanceKey, 1),

    getPreviousVisibleNode: (id) => {
      const instances = get().getVisibleInstances();
      const idx = instances.findIndex((i) => i.nodeId === id);
      return idx > 0 ? instances[idx - 1]!.nodeId : null;
    },

    getNextVisibleNode: (id) => {
      const instances = get().getVisibleInstances();
      const idx = instances.findIndex((i) => i.nodeId === id);
      return idx >= 0 && idx < instances.length - 1 ? instances[idx + 1]!.nodeId : null;
    },

    getBreadcrumbs: () => {
      const { nodes, rootNodeId, homeRootId } = get();
      const chain: Array<{ id: string; text: string }> = [];
      let currentId: string | null = rootNodeId;
      while (currentId && currentId !== homeRootId) {
        const n = nodes.get(currentId);
        if (!n) break;
        chain.unshift({ id: n.id, text: n.text || "Untitled" });
        currentId = n.parentId;
      }
      return chain;
    },

    markTransient: (ids) => {
      const list = Array.isArray(ids) ? ids : [ids];
      set((s) => {
        const next = new Set(s.transientIds);
        for (const id of list) next.add(id);
        return { transientIds: next };
      });
    },

    recordUndo: (entry) => {
      set((s) => ({
        undoStack: [...s.undoStack.slice(-(HISTORY_LIMIT - 1)), entry],
        redoStack: [],
      }));
    },

    applyUndo: () => {
      const st = get();
      const entry = st.undoStack[st.undoStack.length - 1];
      if (!entry) return null;
      const forward = applyHistoryEntry(entry);
      set((s) => ({
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack.slice(-(HISTORY_LIMIT - 1)), forward],
      }));
      return entry;
    },

    applyRedo: () => {
      const st = get();
      const entry = st.redoStack[st.redoStack.length - 1];
      if (!entry) return null;
      const backward = applyHistoryEntry(entry);
      set((s) => ({
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack.slice(-(HISTORY_LIMIT - 1)), backward],
      }));
      return entry;
    },
  };
});
