import { create } from "zustand";
import { DatascriptIndex, type KbIndex } from "@/ds";
import { loadExpandedIds, resolveProps, saveExpandedIds, wireToOutlineMap } from "@/lib/graph-view";
import { rowTextReadOnlyReason } from "@/lib/contextual-ref";
import { outlineInstanceKey } from "@/lib/instance-key";
import { isQueryNode } from "@/lib/query-node";
import { resolveScope, scopedWireNodes } from "@/lib/ontology-scope";
import { toast } from "@/lib/toast";
import { mergeTx } from "@/lib/tx";
import {
  collectVisibleInstances,
  neighborVisibleInstance,
  type VisibleInstance,
} from "@/lib/visible-instances";
import { WORKSPACE_ROOT_ID, isSysPrefixed, type NodeMap, type OutlineNode } from "@/lib/types";
import type { ActionInvocation, WireNode } from "@kb/contracts";
import { logWarn } from "@/lib/log";
import { ingestBrowserTx, replaceBrowserSession } from "@/session/runtime";

export type { VisibleInstance };

const HISTORY_LIMIT = 50;

interface UndoEntry {
  undo: ActionInvocation[];
  redo: ActionInvocation[];
}

export interface ActivateOpts {
  /**
   * Viewport x-coordinate to preserve across vertical navigation (r1 D11).
   * Consumed by NodeContent after caret placement.
   */
  x?: number | null;
}

/** A one-shot request for a mounted text host to place its caret. */
export type CaretIntent = {
  instanceKey: string;
  at: number | "end" | { x: number };
};

interface OutlineState {
  nodes: NodeMap;
  wireNodes: WireNode[];
  /**
   * Query replica of the full graph. Built once in `hydrateFromWire`;
   * `applyTx` is incremental; `rebuild` on snapshot resync. Same instance
   * across ontology scope — only `nodes` is projected.
   */
  index: KbIndex | null;
  rev: number;
  rootNodeId: string;
  homeRootId: string;
  /** Data-layer node id currently being edited. */
  activeNodeId: string | null;
  /** Render-instance key for the active editor (disambiguates duplicates). */
  activeInstanceKey: string | null;
  selectedNodeId: string | null;
  selectedInstanceKey: string | null;
  /**
   * Consumable placement command. Unlike the legacy cursor fields below this
   * is not editor state: ordinary store writes cannot make a host move.
   */
  pendingCaret: CaretIntent | null;
  loadSource: "api" | "fixtures" | null;
  loadError: string | null;
  /**
   * Active ontology scope (r5 §2.5). When set, the OUTLINE PROJECTION is
   * restricted to resolved members; `wireNodes` and `index` stay global so
   * mutations, backlinks, and #query nodes keep honest reach.
   */
  ontologyId: string | null;
  ontologyMembers: Set<string> | null;
  /** Non-fatal resolution warnings (cycle, bad EDN, unknown ref, cap). */
  ontologyWarnings: string[];
  /** rootNodeId to return to when the scope is left. */
  preScopeRootId: string | null;
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
  /** Re-project after the shared local action advanced the existing index. */
  syncFromIndex: () => void;
  /** Full-snapshot resync (rev gap) that preserves zoom/selection/collapse. */
  refreshFromWire: (nodes: WireNode[], rev: number) => void;
  setRootNodeId: (id: string) => void;
  /** Enter (id) / leave (null) an ontology scope. */
  setOntologyScope: (id: string | null) => void;
  zoomTo: (id: string) => void;
  zoomHome: () => void;
  activateNode: (id: string, cursorPos?: number, instanceKey?: string, opts?: ActivateOpts) => void;
  placeCaret: (instanceKey: string, at: CaretIntent["at"]) => void;
  consumeCaret: (instanceKey: string) => CaretIntent | null;
  registerTextHost: (instanceKey: string) => void;
  unregisterTextHost: (instanceKey: string) => void;
  deactivateNode: () => void;
  selectNode: (id: string | null, instanceKey?: string) => void;
  toggleCollapse: (id: string) => void;
  expandAllInScope: () => void;
  collapseAllInScope: () => void;
  expandAncestors: (id: string) => void;
  jumpToNode: (id: string) => void;
  search: (query: string) => Array<{ id: string; text: string }>;
  /** Pages revealed per frame in paginating view modes (frame id -> pages). */
  framePages: Record<string, number>;
  revealMorePages: (frameId: string) => void;
  getVisibleInstances: () => VisibleInstance[];
  getVisibleNodes: () => string[];
  getPreviousVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getNextVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getBreadcrumbs: () => Array<{ id: string; text: string }>;
  /** Register a session-minted transient node id (auto-prune candidate). */
  markTransient: (ids: string | string[]) => void;
  /** Push an undo entry (trims redo tail). */
  recordUndo: (entry: UndoEntry) => void;
  /** Pop undoStack and move the same inverse-invocation pair to redoStack. */
  applyUndo: () => UndoEntry | null;
  /** Pop redoStack and move the same inverse-invocation pair to undoStack. */
  applyRedo: () => UndoEntry | null;
}

/** Data half of `OutlineState` — every member that is not a function. */
export type OutlineStateData = {
  [K in keyof OutlineState as OutlineState[K] extends (...args: never) => unknown
    ? never
    : K]: OutlineState[K];
};

export const initialOutlineState: OutlineStateData = {
  nodes: new Map(),
  wireNodes: [],
  framePages: {},
  index: null,
  rev: 0,
  rootNodeId: WORKSPACE_ROOT_ID,
  homeRootId: WORKSPACE_ROOT_ID,
  activeNodeId: null,
  activeInstanceKey: null,
  selectedNodeId: null,
  selectedInstanceKey: null,
  pendingCaret: null,
  loadSource: null,
  loadError: null,
  ontologyId: null,
  ontologyMembers: null,
  ontologyWarnings: [],
  preScopeRootId: null,
  focusSeq: 0,
  focusX: null,
  transientIds: new Set<string>(),
  undoStack: [],
  redoStack: [],
};

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

interface Projection {
  nodes: NodeMap;
  ontologyMembers: Set<string> | null;
  ontologyWarnings: string[];
}

/**
 * The single place a wire snapshot becomes the outline view model.
 *
 * The index is always the FULL graph — scope is a projection, not a sandbox,
 * so backlinks, `#query` nodes, and WS subscriptions keep global reach
 * (r5 §2.5). Only the array handed to `wireToOutlineMap` is restricted,
 * which is what makes keyboard nav and breadcrumbs scope for free. Search
 * goes through the index, then filters to the projection.
 *
 * `wireNodes` stays this wave: planners (`actions/plan.ts`) already read it,
 * and w5 owns the write path. `index.storedNodes()` would be a second copy
 * of the same snapshot.
 */
function projectOutline(
  wire: WireNode[],
  expanded: Set<string>,
  ontologyId: string | null,
  index: KbIndex,
): Projection {
  if (ontologyId === null) {
    return {
      nodes: wireToOutlineMap(wire, expanded),
      ontologyMembers: null,
      ontologyWarnings: [],
    };
  }
  const resolution = resolveScope(wire, ontologyId, index, index.generation);
  return {
    nodes: wireToOutlineMap(scopedWireNodes(wire, resolution.members, ontologyId), expanded),
    ontologyMembers: resolution.members,
    ontologyWarnings: resolution.warnings,
  };
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
   * FocusRegistry's mounted half. Visibility is checked synchronously during
   * activation; this set closes the final race between projection and React
   * mounting so an orphaned active id cannot eat keyboard input.
   */
  const mountedTextHosts = new Set<string>();

  function syncFromIndex(): void {
    const prev = get();
    if (prev.index === null) return;
    const wireNodes = prev.index.storedNodes();
    const expanded = collectExpanded(prev.nodes);
    for (const id of loadExpandedIds()) expanded.add(id);
    const projection = projectOutline(wireNodes, expanded, prev.ontologyId, prev.index);
    const nodes = projection.nodes;
    set({
      wireNodes,
      nodes,
      ontologyMembers: projection.ontologyMembers,
      ontologyWarnings: projection.ontologyWarnings,
      rootNodeId: nodes.has(prev.rootNodeId) ? prev.rootNodeId : prev.homeRootId,
      selectedNodeId:
        prev.selectedNodeId !== null && nodes.has(prev.selectedNodeId) ? prev.selectedNodeId : null,
      activeNodeId:
        prev.activeNodeId !== null && nodes.has(prev.activeNodeId) ? prev.activeNodeId : null,
    });
  }

  function fallBackFromMissingHost(instanceKey: string): void {
    const active = get();
    if (active.activeInstanceKey !== instanceKey || mountedTextHosts.has(instanceKey)) return;
    if (import.meta.env.DEV) {
      logWarn(`kb: active text host did not mount: ${instanceKey}`);
    }
    set({
      activeNodeId: null,
      activeInstanceKey: null,
      pendingCaret: null,
    });
  }

  /**
   * Prune the outgoing active row when it is an empty session transient
   * (r1 §3.3 auto-prune). nextId = incoming focus target; null when focus
   * leaves the outline entirely.
   */
  function pruneOutgoingTransient(nextId: string | null): void {
    const st = get();
    const out = st.activeNodeId;
    if (out === null || out === nextId) return;
    const node = st.nodes.get(out);
    if (!isPrunableTransient(node, out, st.transientIds)) return;
    const nextWire = mergeTx(st.wireNodes, [], [out]);
    const expanded = collectExpanded(st.nodes);
    for (const id of loadExpandedIds()) expanded.add(id);
    const nextTransient = new Set(st.transientIds);
    nextTransient.delete(out);
    const index = st.index ?? new DatascriptIndex(nextWire);
    if (st.index !== null) {
      ingestBrowserTx({ upserts: [], deletes: [out] });
    }
    const projection = projectOutline(nextWire, expanded, st.ontologyId, index);
    set({
      wireNodes: nextWire,
      nodes: projection.nodes,
      index,
      ontologyMembers: projection.ontologyMembers,
      ontologyWarnings: projection.ontologyWarnings,
      transientIds: nextTransient,
    });
  }

  /**
   * A scope must never be a dead end. Navigating to a node outside the member
   * set (⌘K palette, a `[[ref]]` out of scope) leaves the scope instead of
   * silently doing nothing. Returns true when the target is reachable.
   */
  function escapeScopeFor(id: string): boolean {
    const st = get();
    if (st.nodes.has(id)) return true;
    if (st.ontologyId === null) return false;
    if (!st.wireNodes.some((n) => n.id === id)) return false;
    get().setOntologyScope(null);
    toast("Left the ontology to follow that node");
    return get().nodes.has(id);
  }

  return {
    ...initialOutlineState,

    hydrateFromWire: (wireNodes, rev, source) => {
      const expanded = loadExpandedIds();
      // A fresh load starts unscoped; App re-applies the URL scope after.
      const index = new DatascriptIndex(wireNodes);
      replaceBrowserSession(wireNodes, index, syncFromIndex);
      const projection = projectOutline(wireNodes, expanded, null, index);
      set({
        wireNodes,
        nodes: projection.nodes,
        index,
        rev,
        loadSource: source,
        loadError: null,
        rootNodeId: WORKSPACE_ROOT_ID,
        homeRootId: WORKSPACE_ROOT_ID,
        activeNodeId: null,
        activeInstanceKey: null,
        pendingCaret: null,
        selectedNodeId: null,
        selectedInstanceKey: null,
        ontologyId: null,
        ontologyMembers: null,
        ontologyWarnings: [],
        preScopeRootId: null,
        transientIds: new Set<string>(),
        undoStack: [],
        redoStack: [],
      });
    },

    applyTx: (upserts, deletes, opts) => {
      const prev = get();
      ingestBrowserTx({ upserts, deletes });
      const nextWire = mergeTx(prev.wireNodes, upserts, deletes);
      const expanded = collectExpanded(prev.nodes);
      for (const id of loadExpandedIds()) expanded.add(id);
      const nextRev = opts?.rev ?? prev.rev;
      const index = prev.index ?? new DatascriptIndex(nextWire);
      const projection = projectOutline(nextWire, expanded, prev.ontologyId, index);
      const nodes = projection.nodes;
      // Deleted nodes must not remain the zoom root / selection.
      const rootNodeId = nodes.has(prev.rootNodeId) ? prev.rootNodeId : prev.homeRootId;
      const selectedNodeId =
        prev.selectedNodeId !== null && nodes.has(prev.selectedNodeId) ? prev.selectedNodeId : null;
      const activeNodeId =
        prev.activeNodeId !== null && nodes.has(prev.activeNodeId) ? prev.activeNodeId : null;
      const transientIds = new Set<string>();
      for (const id of prev.transientIds) {
        if (nodes.has(id)) transientIds.add(id);
      }
      set({
        wireNodes: nextWire,
        nodes,
        index,
        ontologyMembers: projection.ontologyMembers,
        ontologyWarnings: projection.ontologyWarnings,
        rev: nextRev,
        rootNodeId,
        selectedNodeId,
        selectedInstanceKey: selectedNodeId !== null ? prev.selectedInstanceKey : null,
        activeNodeId,
        activeInstanceKey: activeNodeId !== null ? prev.activeInstanceKey : null,
        transientIds,
      });
    },

    syncFromIndex,

    refreshFromWire: (wireNodes, rev) => {
      const prev = get();
      const expanded = collectExpanded(prev.nodes);
      const index = prev.index ?? new DatascriptIndex(wireNodes);
      if (prev.index !== null) index.rebuild(wireNodes);
      replaceBrowserSession(wireNodes, index, syncFromIndex);
      const projection = projectOutline(wireNodes, expanded, prev.ontologyId, index);
      const nodes = projection.nodes;
      const rootNodeId = nodes.has(prev.rootNodeId) ? prev.rootNodeId : prev.homeRootId;
      const selectedNodeId =
        prev.selectedNodeId !== null && nodes.has(prev.selectedNodeId) ? prev.selectedNodeId : null;
      const activeNodeId =
        prev.activeNodeId !== null && nodes.has(prev.activeNodeId) ? prev.activeNodeId : null;
      const transientIds = new Set<string>();
      for (const id of prev.transientIds) {
        if (nodes.has(id)) transientIds.add(id);
      }
      set({
        wireNodes,
        nodes,
        index,
        ontologyMembers: projection.ontologyMembers,
        ontologyWarnings: projection.ontologyWarnings,
        rev,
        rootNodeId,
        selectedNodeId,
        selectedInstanceKey: selectedNodeId !== null ? prev.selectedInstanceKey : null,
        activeNodeId,
        activeInstanceKey: activeNodeId !== null ? prev.activeInstanceKey : null,
        transientIds,
      });
    },

    setRootNodeId: (id) => set({ rootNodeId: id }),

    setOntologyScope: (id) => {
      const prev = get();
      if (prev.ontologyId === id) return;
      pruneOutgoingTransient(null);
      const st = get();
      const expanded = collectExpanded(st.nodes);
      for (const eid of loadExpandedIds()) expanded.add(eid);
      const index = st.index ?? new DatascriptIndex(st.wireNodes);
      const projection = projectOutline(st.wireNodes, expanded, id, index);

      if (id === null) {
        // Leaving: return to the root the user was on before entering.
        const restored =
          st.preScopeRootId !== null && projection.nodes.has(st.preScopeRootId)
            ? st.preScopeRootId
            : WORKSPACE_ROOT_ID;
        set({
          ontologyId: null,
          ontologyMembers: null,
          ontologyWarnings: [],
          preScopeRootId: null,
          nodes: projection.nodes,
          rootNodeId: restored,
          homeRootId: WORKSPACE_ROOT_ID,
          selectedNodeId: null,
          selectedInstanceKey: null,
          activeNodeId: null,
          activeInstanceKey: null,
        });
        return;
      }

      // Entering: the ontology becomes both the zoom root and home, so an
      // exit path always exists even if the previous root is not a member.
      set({
        ontologyId: id,
        ontologyMembers: projection.ontologyMembers,
        ontologyWarnings: projection.ontologyWarnings,
        preScopeRootId: st.ontologyId === null ? st.rootNodeId : st.preScopeRootId,
        nodes: projection.nodes,
        rootNodeId: id,
        homeRootId: id,
        selectedNodeId: null,
        selectedInstanceKey: null,
        activeNodeId: null,
        activeInstanceKey: null,
      });
    },

    zoomTo: (id) => {
      if (!escapeScopeFor(id)) return;
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
      // A row whose text is not its own is read-only at the DOM level:
      // activation degrades to selection so no caret ever enters it (r1 D20).
      // `rowTextReadOnlyReason` owns which rows those are — sys.* nodes and
      // contextual references, whose text belongs to the referenced node.
      if (rowTextReadOnlyReason(id, get().nodes.get(id)) !== null) {
        pruneOutgoingTransient(id);
        const roKey = resolveActivateKey(id, instanceKey, get().nodes);
        set({
          selectedNodeId: id,
          selectedInstanceKey: roKey,
          activeNodeId: null,
          activeInstanceKey: null,
        });
        return;
      }
      // Reveal the full parent chain before validating the instance. Creation,
      // indent, and palette navigation therefore cannot focus a hidden row.
      get().expandAncestors(id);
      const revealed = get();
      const key = resolveActivateKey(id, instanceKey, revealed.nodes);
      // Reference instances are projected by query components, so their exact
      // visibility is only knowable once that component mounts. The mounted-host
      // half of the registry below validates them after React commits.
      const isReferenceInstance = key.startsWith("ref:");
      if (
        !isReferenceInstance &&
        !revealed.getVisibleInstances().some((item) => item.instanceKey === key)
      ) {
        if (import.meta.env.DEV) logWarn(`kb: refused unreachable focus target: ${key}`);
        toast("That node is not visible in this outline");
        return;
      }
      // Tana transient rule: an empty session-minted node prunes the moment
      // focus moves to a different row (r1 §3.3).
      pruneOutgoingTransient(id);
      const at: CaretIntent["at"] =
        opts?.x !== null && opts?.x !== undefined ? { x: opts.x } : (cursorPos ?? 0);
      set({
        activeNodeId: id,
        activeInstanceKey: key,
        selectedNodeId: id,
        selectedInstanceKey: key,
        pendingCaret: { instanceKey: key, at },
        focusX: null,
      });
      if (typeof window !== "undefined") {
        // Let React finish a full paint cycle (including a virtualized list
        // remount) before treating the focus target as unavailable.
        window.setTimeout(() => fallBackFromMissingHost(key), 250);
      }
    },

    placeCaret: (instanceKey, at) => {
      const st = get();
      if (st.activeInstanceKey !== instanceKey) return;
      set({ pendingCaret: { instanceKey, at } });
    },

    consumeCaret: (instanceKey) => {
      const intent = get().pendingCaret;
      if (!intent || intent.instanceKey !== instanceKey) return null;
      set({ pendingCaret: null });
      return intent;
    },

    registerTextHost: (instanceKey) => {
      mountedTextHosts.add(instanceKey);
    },

    unregisterTextHost: (instanceKey) => {
      mountedTextHosts.delete(instanceKey);
      if (typeof window !== "undefined") {
        window.setTimeout(() => fallBackFromMissingHost(instanceKey), 250);
      }
    },

    deactivateNode: () => {
      pruneOutgoingTransient(null);
      set({ activeNodeId: null, activeInstanceKey: null, pendingCaret: null });
    },

    selectNode: (id, instanceKey) => {
      if (id === null) {
        pruneOutgoingTransient(null);
        set({
          selectedNodeId: null,
          selectedInstanceKey: null,
          activeNodeId: null,
          activeInstanceKey: null,
          pendingCaret: null,
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
        pendingCaret: null,
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
      while (current !== undefined && current.parentId !== null) {
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
      if (id === WORKSPACE_ROOT_ID || !escapeScopeFor(id)) return;
      const { expandAncestors, activateNode } = get();
      expandAncestors(id);
      // Ensure zoom shows the node: if not under current root, go home
      const visible = get().getVisibleNodes();
      if (!visible.includes(id)) {
        set({ rootNodeId: get().homeRootId });
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

    search: (query) => {
      const { index, nodes } = get();
      if (index === null) return [];
      const q = query.trim();
      if (!q) return [];
      return index
        .search(q, 50)
        .filter((n) => nodes.has(n.id))
        .map((n) => ({ id: n.id, text: n.text }));
    },

    getVisibleInstances: () => {
      const { nodes, rootNodeId, index, framePages } = get();
      return collectVisibleInstances(rootNodeId, nodes, index, framePages);
    },

    revealMorePages: (frameId) =>
      set((s) => ({
        framePages: {
          ...s.framePages,
          [frameId]: (s.framePages[frameId] ?? 1) + 1,
        },
      })),

    getVisibleNodes: () =>
      get()
        .getVisibleInstances()
        .map((i) => i.nodeId),

    getPreviousVisibleInstance: (instanceKey) =>
      neighborVisibleInstance(get().getVisibleInstances(), instanceKey, -1),

    getNextVisibleInstance: (instanceKey) =>
      neighborVisibleInstance(get().getVisibleInstances(), instanceKey, 1),

    getBreadcrumbs: () => {
      const { nodes, rootNodeId, homeRootId } = get();
      const chain: Array<{ id: string; text: string }> = [];
      let currentId: string | null = rootNodeId;
      while (currentId !== null && currentId !== homeRootId) {
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
      set((s) => ({
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack.slice(-(HISTORY_LIMIT - 1)), entry],
      }));
      return entry;
    },

    applyRedo: () => {
      const st = get();
      const entry = st.redoStack[st.redoStack.length - 1];
      if (!entry) return null;
      set((s) => ({
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack.slice(-(HISTORY_LIMIT - 1)), entry],
      }));
      return entry;
    },
  };
});
