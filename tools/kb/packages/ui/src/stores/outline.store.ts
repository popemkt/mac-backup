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
import { rowTextReadOnlyReason } from "@/lib/contextual-ref";
import { outlineInstanceKey } from "@/lib/instance-key";
import { isQueryNode } from "@/lib/query-node";
import { resolveScope, scopedWireNodes } from "@/lib/ontology-scope";
import { toast } from "@/lib/toast";
import { cloneWire, mergeTx } from "@/lib/tx";
import {
  collectVisibleInstances,
  neighborVisibleInstance,
  type VisibleInstance,
} from "@/lib/visible-instances";
import { WORKSPACE_ROOT_ID, isSysPrefixed, type NodeMap, type OutlineNode } from "@/lib/types";
import type { InverseTx } from "@/actions/plan";
import type { WireNode } from "@kb/contracts";
import { logWarn } from "@/lib/log";

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

/** A one-shot request for a mounted text host to place its caret. */
export type CaretIntent = {
  instanceKey: string;
  at: number | "end" | { x: number };
};

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
  /**
   * Consumable placement command. Unlike the legacy cursor fields below this
   * is not editor state: ordinary store writes cannot make a host move.
   */
  pendingCaret: CaretIntent | null;
  /**
   * @deprecated Read by nothing. The canvas card is on `pendingCaret` like
   * every other host; this field is written and never observed.
   * GAP [[01M1MGT307N4K243CBPJTXNG5X]] — deleting it is a public store shape
   * change that also edits the hand-copied reset literal in 24 ui test files.
   */
  cursorPosition: number;
  loadSource: "api" | "fixtures" | null;
  loadError: string | null;
  /**
   * Active ontology scope (r5 §2.5). When set, the OUTLINE PROJECTION is
   * restricted to resolved members; `wireNodes` and `queryDb` stay global so
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
  /** Restore a prior wire snapshot (optimistic revert). */
  restoreSnapshot: (nodes: WireNode[], rev: number) => void;
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

interface Projection {
  nodes: NodeMap;
  queryDb: QueryDb;
  ontologyMembers: Set<string> | null;
  ontologyWarnings: string[];
}

/**
 * The single place a wire snapshot becomes the outline view model.
 *
 * `queryDb` is always built over the FULL snapshot — scope is a projection,
 * not a sandbox, so backlinks, `#query` nodes, and WS subscriptions keep global
 * reach (r5 §2.5). Only the array handed to `wireToOutlineMap` is restricted,
 * which is what makes search, keyboard nav, and breadcrumbs scope for free.
 */
function projectWire(
  wire: WireNode[],
  expanded: Set<string>,
  rev: number,
  ontologyId: string | null,
): Projection {
  const queryDb = buildQueryDb(wire, rev);
  if (ontologyId === null) {
    return {
      nodes: wireToOutlineMap(wire, expanded),
      queryDb,
      ontologyMembers: null,
      ontologyWarnings: [],
    };
  }
  const resolution = resolveScope(wire, ontologyId, queryDb, rev);
  return {
    nodes: wireToOutlineMap(scopedWireNodes(wire, resolution.members, ontologyId), expanded),
    queryDb,
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
    const projection = projectWire(nextWire, expanded, st.rev, st.ontologyId);
    set({
      wireNodes: nextWire,
      nodes: projection.nodes,
      queryDb: projection.queryDb,
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

  /** Apply an inverse/forward tx; return the opposite-direction entry. */
  function applyHistoryEntry(entry: UndoEntry): UndoEntry {
    const st = get();
    const touched = new Set<string>([...entry.inv.upserts.map((u) => u.id), ...entry.inv.deletes]);
    // Capture the opposite-direction entry AGAINST THE PRE-APPLICATION
    // STATE: survivors revert to their pre-apply payload; ids this entry
    // restores (absent now) are removed again by the opposite pass.
    const oppositeUpserts: WireNode[] = [];
    for (const n of st.wireNodes) {
      if (touched.has(n.id)) oppositeUpserts.push(cloneWire(n));
    }
    const oppositeDeletes = entry.inv.upserts
      .map((u) => u.id)
      .filter((id) => !st.wireNodes.some((n) => n.id === id));

    const postWire = mergeTx(st.wireNodes, entry.inv.upserts, entry.inv.deletes);
    const expanded = collectExpanded(st.nodes);
    for (const id of loadExpandedIds()) expanded.add(id);
    const survives = (id: string | null): boolean =>
      id !== null && postWire.some((n) => n.id === id);
    const selectedNodeId = survives(st.selectedNodeId) ? st.selectedNodeId : null;
    const projection = projectWire(postWire, expanded, st.rev, st.ontologyId);
    set({
      wireNodes: postWire,
      nodes: projection.nodes,
      queryDb: projection.queryDb,
      ontologyMembers: projection.ontologyMembers,
      ontologyWarnings: projection.ontologyWarnings,
      selectedNodeId,
      selectedInstanceKey: selectedNodeId !== null ? st.selectedInstanceKey : null,
      activeNodeId: null,
      activeInstanceKey: null,
    });
    return {
      inv: { upserts: oppositeUpserts, deletes: oppositeDeletes },
      actions: [],
    };
  }

  return {
    nodes: new Map(),
    wireNodes: [],
    framePages: {},
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    pendingCaret: null,
    cursorPosition: 0,
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

    hydrateFromWire: (wireNodes, rev, source) => {
      const expanded = loadExpandedIds();
      // A fresh load starts unscoped; App re-applies the URL scope after.
      const projection = projectWire(wireNodes, expanded, rev, null);
      set({
        wireNodes,
        nodes: projection.nodes,
        queryDb: projection.queryDb,
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
      const nextWire = mergeTx(prev.wireNodes, upserts, deletes);
      const expanded = collectExpanded(prev.nodes);
      for (const id of loadExpandedIds()) expanded.add(id);
      const nextRev = opts?.rev ?? prev.rev;
      const projection = projectWire(nextWire, expanded, nextRev, prev.ontologyId);
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
        queryDb: projection.queryDb,
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

    restoreSnapshot: (wireNodes, rev) => {
      const prev = get();
      // Never rewind rev: concurrent WS/refetch may have advanced past the
      // pre-optimistic baseline. Node payload may still roll back; rev must not.
      const nextRev = Math.max(prev.rev, rev);
      const expanded = collectExpanded(prev.nodes);
      for (const id of loadExpandedIds()) expanded.add(id);
      const projection = projectWire(wireNodes, expanded, nextRev, prev.ontologyId);
      set({
        wireNodes,
        nodes: projection.nodes,
        queryDb: projection.queryDb,
        ontologyMembers: projection.ontologyMembers,
        ontologyWarnings: projection.ontologyWarnings,
        rev: nextRev,
      });
    },

    refreshFromWire: (wireNodes, rev) => {
      const prev = get();
      const expanded = collectExpanded(prev.nodes);
      const projection = projectWire(wireNodes, expanded, rev, prev.ontologyId);
      const nodes = projection.nodes;
      const queryDb = projection.queryDb;
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
        queryDb,
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
      const projection = projectWire(st.wireNodes, expanded, st.rev, id);

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
          queryDb: projection.queryDb,
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
        queryDb: projection.queryDb,
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
        // Dead write. Every host, canvas included, takes its caret from
        // `pendingCaret`. GAP [[01M1MGT307N4K243CBPJTXNG5X]].
        cursorPosition: cursorPos ?? 0,
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

    search: (query) => searchNodes(get().nodes, query),

    getVisibleInstances: () => {
      const { nodes, rootNodeId, queryDb, framePages } = get();
      return collectVisibleInstances(rootNodeId, nodes, queryDb, framePages);
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
