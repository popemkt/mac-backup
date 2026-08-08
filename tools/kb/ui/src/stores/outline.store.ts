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
import { isQueryNode } from "@/lib/query-node";
import { mergeTx } from "@/lib/tx";
import {
  WORKSPACE_ROOT_ID,
  type NodeMap,
  type OutlineNode,
} from "@/lib/types";
import type { WireNode } from "@kb/protocol";

interface OutlineState {
  nodes: NodeMap;
  wireNodes: WireNode[];
  queryDb: QueryDb | null;
  rev: number;
  rootNodeId: string;
  homeRootId: string;
  activeNodeId: string | null;
  selectedNodeId: string | null;
  cursorPosition: number;
  loadSource: "api" | "fixtures" | null;
  loadError: string | null;

  hydrateFromWire: (
    nodes: WireNode[],
    rev: number,
    source: "api" | "fixtures",
  ) => void;
  /** Apply node-level delta (optimistic edits + WS tx). */
  applyTx: (
    upserts: WireNode[],
    deletes: string[],
    opts?: { rev?: number },
  ) => void;
  /** Restore a prior wire snapshot (optimistic revert). */
  restoreSnapshot: (nodes: WireNode[], rev: number) => void;
  /** Full-snapshot resync (rev gap) that preserves zoom/selection/collapse. */
  refreshFromWire: (nodes: WireNode[], rev: number) => void;
  setRootNodeId: (id: string) => void;
  zoomTo: (id: string) => void;
  zoomHome: () => void;
  activateNode: (id: string, cursorPos?: number) => void;
  deactivateNode: () => void;
  selectNode: (id: string | null) => void;
  toggleCollapse: (id: string) => void;
  expandAllInScope: () => void;
  collapseAllInScope: () => void;
  expandAncestors: (id: string) => void;
  jumpToNode: (id: string) => void;
  search: (query: string) => Array<{ id: string; text: string }>;
  getVisibleNodes: () => string[];
  getPreviousVisibleNode: (id: string) => string | null;
  getNextVisibleNode: (id: string) => string | null;
  getBreadcrumbs: () => Array<{ id: string; text: string }>;
}

function getVisibleNodesRecursive(
  nodeId: string,
  nodes: NodeMap,
  result: string[],
): void {
  const node = nodes.get(nodeId);
  if (!node) return;
  result.push(nodeId);
  if (!node.collapsed) {
    for (const childId of node.children) {
      getVisibleNodesRecursive(childId, nodes, result);
    }
  }
}

function collectExpanded(nodes: NodeMap): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes.values()) {
    if (!n.collapsed && n.id !== WORKSPACE_ROOT_ID) ids.add(n.id);
  }
  return ids;
}

function collectSubtreeIds(
  nodeId: string,
  nodes: NodeMap,
  result: string[],
): void {
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

export const useOutlineStore = create<OutlineState>((set, get) => ({
  nodes: new Map(),
  wireNodes: [],
  queryDb: null,
  rev: 0,
  rootNodeId: WORKSPACE_ROOT_ID,
  homeRootId: WORKSPACE_ROOT_ID,
  activeNodeId: null,
  selectedNodeId: null,
  cursorPosition: 0,
  loadSource: null,
  loadError: null,

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
    const rootNodeId = nodes.has(prev.rootNodeId)
      ? prev.rootNodeId
      : prev.homeRootId;
    const selectedNodeId =
      prev.selectedNodeId && nodes.has(prev.selectedNodeId)
        ? prev.selectedNodeId
        : null;
    const activeNodeId =
      prev.activeNodeId && nodes.has(prev.activeNodeId)
        ? prev.activeNodeId
        : null;
    set({
      wireNodes: nextWire,
      nodes,
      queryDb: buildQueryDb(nextWire, nextRev),
      rev: nextRev,
      rootNodeId,
      selectedNodeId,
      activeNodeId,
    });
  },

  restoreSnapshot: (wireNodes, rev) => {
    const prevNodes = get().nodes;
    const expanded = collectExpanded(prevNodes);
    for (const id of loadExpandedIds()) expanded.add(id);
    set({
      wireNodes,
      nodes: wireToOutlineMap(wireNodes, expanded),
      queryDb: buildQueryDb(wireNodes, rev),
      rev,
    });
  },

  refreshFromWire: (wireNodes, rev) => {
    const prev = get();
    const expanded = collectExpanded(prev.nodes);
    const nodes = wireToOutlineMap(wireNodes, expanded);
    const queryDb = buildQueryDb(wireNodes, rev);
    const rootNodeId = nodes.has(prev.rootNodeId)
      ? prev.rootNodeId
      : prev.homeRootId;
    const selectedNodeId =
      prev.selectedNodeId && nodes.has(prev.selectedNodeId)
        ? prev.selectedNodeId
        : null;
    const activeNodeId =
      prev.activeNodeId && nodes.has(prev.activeNodeId)
        ? prev.activeNodeId
        : null;
    set({
      wireNodes,
      nodes,
      queryDb,
      rev,
      rootNodeId,
      selectedNodeId,
      activeNodeId,
    });
  },

  setRootNodeId: (id) => set({ rootNodeId: id }),

  zoomTo: (id) => {
    const { nodes } = get();
    if (!nodes.has(id)) return;
    set({ rootNodeId: id, selectedNodeId: id, activeNodeId: null });
  },

  zoomHome: () =>
    set({
      rootNodeId: get().homeRootId,
      selectedNodeId: null,
      activeNodeId: null,
    }),

  activateNode: (id, cursorPos) =>
    set({
      activeNodeId: id,
      selectedNodeId: id,
      cursorPosition: cursorPos ?? 0,
    }),

  deactivateNode: () => set({ activeNodeId: null }),

  selectNode: (id) => set({ selectedNodeId: id, activeNodeId: null }),

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
    activateNode(id, 0);
    // scroll into view after paint
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-node-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  },

  search: (query) => searchNodes(get().nodes, query),

  getVisibleNodes: () => {
    const { nodes, rootNodeId } = get();
    const root = nodes.get(rootNodeId);
    if (!root) return [];
    const result: string[] = [];
    // When zoomed into a real node, show that node + descendants
    if (rootNodeId !== WORKSPACE_ROOT_ID) {
      getVisibleNodesRecursive(rootNodeId, nodes, result);
      return result;
    }
    for (const childId of root.children) {
      getVisibleNodesRecursive(childId, nodes, result);
    }
    return result;
  },

  getPreviousVisibleNode: (id) => {
    const visible = get().getVisibleNodes();
    const idx = visible.indexOf(id);
    return idx > 0 ? visible[idx - 1]! : null;
  },

  getNextVisibleNode: (id) => {
    const visible = get().getVisibleNodes();
    const idx = visible.indexOf(id);
    return idx < visible.length - 1 ? visible[idx + 1]! : null;
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
}));
