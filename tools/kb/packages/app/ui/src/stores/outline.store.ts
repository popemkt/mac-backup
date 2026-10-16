/**
 * The outline editor's state: its projection of the graph (`nodes`, each node
 * with its expansion), the row being edited and the row selected, the caret
 * hand-off, the text-host registry, the rows it minted empty, and the pages
 * its frames reveal. The graph it projects, the zoom root and the scope are
 * the graph store's (`stores/graph.store.ts`); this store derives from it as
 * its editing projection and holds no copy of it.
 */
import { create } from "zustand";
import {
  fieldContextOf,
  isProjectedInstance,
  isSysPrefixed,
  loadExpandedIds,
  logWarn,
  MAIN_OUTLINE_HOST,
  outlineInstanceKey,
  resolveProps,
  resolveVisibleProps,
  rowTextReadOnlyReason,
  saveExpandedIds,
  schemaOf,
  SYSTEM_IDS,
  toast,
  wireToOutlineMap,
  WORKSPACE_ROOT_ID,
  type CaretIntent,
  type FamilyView,
  type FieldContext,
  type NodeMap,
  type OutlineCommandApi,
  type OutlineNode,
  type FieldContextSource,
  type SchemaIndex,
} from "@kb/ui-sdk";
import { isQueryNode } from "@kb/model";
import {
  collectVisibleInstances,
  neighborVisibleInstance,
  type VisibleInstance,
} from "@/lib/visible-instances";
import type { FrameViewKey } from "@kb/views";
import { providedFrameViews } from "@/stores/frame-views";
import {
  provideEditingProjection,
  scopedWireOf,
  useGraphStore,
  type GraphChange,
  type GraphStateData,
} from "@/stores/graph.store";
import { outlineHostOf, outlineHostOfInstance as walkHostOf } from "@/stores/outline-hosts";

export type { VisibleInstance };

export interface ActivateOpts {
  /**
   * Viewport x-coordinate to preserve across vertical navigation (r1 D11).
   * Consumed by NodeContent after caret placement.
   */
  x?: number | null;
}

interface OutlineState {
  /** The outline's projection of the graph under its scope, with each node's expansion. */
  nodes: NodeMap;
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
  /** Bumped on every activateNode so remounts re-place the caret. */
  focusSeq: number;
  /** Pending column-preservation target for the next activation (D11). */
  focusX: number | null;
  /** Session-minted transient node ids; empty ones prune on deactivate. */
  transientIds: Set<string>;

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
  /** Reveal `id` in the outline: expand its ancestors, zoom out if needed, edit its row. */
  jumpToNode: (id: string) => void;
  /** Pages revealed per frame in paginating view modes (frame id -> pages). */
  framePages: Record<string, number>;
  revealMorePages: (frameId: string) => void;
  /** The frame views provided, in their pickers' order (`stores/frame-views`). */
  frameViews: () => readonly FamilyView<FrameViewKey>[];
  /** The rows outline host `host` (the main pane's by default) draws, in render order. */
  getVisibleInstances: (host?: string) => VisibleInstance[];
  getVisibleNodes: () => string[];
  getPreviousVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getNextVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getBreadcrumbs: () => Array<{ id: string; text: string }>;
  /** Register a session-minted transient node id (auto-prune candidate). */
  markTransient: (ids: string | string[]) => void;
}

/** Data half of `OutlineState` — every member that is not a function. */
export type OutlineStateData = {
  [K in keyof OutlineState as OutlineState[K] extends (...args: never) => unknown
    ? never
    : K]: OutlineState[K];
};

export const initialOutlineState: OutlineStateData = {
  nodes: new Map(),
  framePages: {},
  activeNodeId: null,
  activeInstanceKey: null,
  selectedNodeId: null,
  selectedInstanceKey: null,
  pendingCaret: null,
  focusSeq: 0,
  focusX: null,
  transientIds: new Set<string>(),
};

/** The schema the outline resolves against: the graph's (`schemaOf`). */
function schemaNow(): SchemaIndex {
  return schemaOf(useGraphStore.getState());
}

function collectExpanded(nodes: NodeMap): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes.values()) {
    if (!n.collapsed && n.id !== WORKSPACE_ROOT_ID) ids.add(n.id);
  }
  return ids;
}

/** `expanded`, with the expansion kept in storage added to it. */
function withStoredExpansion(expanded: Set<string>): Set<string> {
  for (const id of loadExpandedIds()) expanded.add(id);
  return expanded;
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

/** `schema` is the map field definitions are read from (`lib/schema.ts`). */
function isExpandableOutlineNode(node: OutlineNode, schema: SchemaIndex): boolean {
  if (node.children.length > 0) return true;
  if (isQueryNode(node)) return true;
  return resolveProps(node, schema).length > 0;
}

/**
 * The single place a graph state becomes the outline view model.
 *
 * The graph store's index is always the FULL graph — scope is a projection,
 * not a sandbox, so backlinks, `#query` nodes, and WS subscriptions keep
 * global reach (r5 §2.5). Only the array handed to `wireToOutlineMap` is
 * restricted (`scopedWireOf`), which is what makes keyboard nav and
 * breadcrumbs scope for free.
 *
 * `previous` is the projection this one replaces; a node that projects to the
 * same value keeps its object (`wireToOutlineMap`). A fresh load has none.
 */
function projectOutline(graph: GraphStateData, expanded: Set<string>, previous?: NodeMap): NodeMap {
  // `wireNodes` is the whole graph: the projection resolves schema and the tag
  // palette against it, whatever it shows (`lib/schema.ts`).
  const nodes = wireToOutlineMap(scopedWireOf(graph), expanded, graph.wireNodes, previous);
  // Unscoped, this projection stands for the snapshot's schema (`schemaOf`):
  // it is handed in now, before any reader of the graph store can ask.
  schemaOf({ ontologyId: graph.ontologyId, wireNodes: graph.wireNodes, nodes });
  return nodes;
}

/** No row edited, none selected, no caret pending. */
const NO_FOCUS = {
  activeNodeId: null,
  activeInstanceKey: null,
  selectedNodeId: null,
  selectedInstanceKey: null,
} as const;

/**
 * The instance to activate `id` at: the one named, else its row in the
 * outline being worked in (the host of `working`, the current selection).
 */
function resolveActivateKey(
  id: string,
  instanceKey: string | undefined,
  nodes: NodeMap,
  working: string | null,
): string {
  return instanceKey ?? outlineInstanceKey(id, nodes, walkHostOf(working));
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
  schema: SchemaIndex,
): boolean {
  if (!node || !transientIds.has(id)) return false;
  if (isSysPrefixed(id)) return false;
  if (node.text !== "") return false;
  if (node.children.length > 0) return false;
  // Content is a value the node holds — hidden or not, since pruning deletes
  // it — never an empty slot a supertag templates. Tags alone are not content.
  return !resolveVisibleProps(node, schema, { showDebugFields: true }).some(
    (prop) => prop.empty !== true && prop.fieldId !== SYSTEM_IDS.typeField,
  );
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

  return {
    ...initialOutlineState,

    activateNode: (id, cursorPos, instanceKey, opts) => {
      if (!get().nodes.has(id)) return;
      // A row whose text cannot be written is read-only at the DOM level:
      // activation degrades to selection so no caret ever enters it (r1 D20).
      // `rowTextReadOnlyReason` owns which rows those are — sys.* text, and a
      // contextual reference whose target is gone.
      if (rowTextReadOnlyReason(id, get().nodes.get(id), schemaNow()) !== null) {
        // The outline being worked in is the one the focus is leaving.
        const roKey = resolveActivateKey(id, instanceKey, get().nodes, get().selectedInstanceKey);
        pruneOutgoingTransient(id);
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
      const key = resolveActivateKey(id, instanceKey, revealed.nodes, revealed.selectedInstanceKey);
      // Projected instances (query rows, canvas cards) are drawn by the component
      // that mounts them, so their exact
      // visibility is only knowable once it mounts. The mounted-host
      // half of the registry below validates them after React commits.
      if (
        !isProjectedInstance(key) &&
        !revealed.getVisibleInstances(walkHostOf(key)).some((item) => item.instanceKey === key)
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
        set({ ...NO_FOCUS, pendingCaret: null });
        return;
      }
      const { nodes, selectedInstanceKey } = get();
      if (!nodes.has(id)) return;
      // The outline being worked in is the one the focus is leaving.
      const key = resolveActivateKey(id, instanceKey, nodes, selectedInstanceKey);
      pruneOutgoingTransient(id);
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
      const expandable = isExpandableOutlineNode(node, schemaNow());
      if (!expandable) return;
      const next = new Map(nodes);
      next.set(id, { ...node, collapsed: !node.collapsed });
      saveExpandedIds(collectExpanded(next));
      set({ nodes: next });
    },

    expandAllInScope: () => {
      const { nodes } = get();
      const schema = schemaNow();
      const next = new Map(nodes);
      let changed = false;
      for (const id of scopeNodeIds(next, useGraphStore.getState().rootNodeId)) {
        const node = next.get(id);
        if (!node || !isExpandableOutlineNode(node, schema)) continue;
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
      const { nodes } = get();
      const schema = schemaNow();
      const next = new Map(nodes);
      let changed = false;
      for (const id of scopeNodeIds(next, useGraphStore.getState().rootNodeId)) {
        const node = next.get(id);
        if (!node || !isExpandableOutlineNode(node, schema)) continue;
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
      const graph = useGraphStore.getState();
      if (id === WORKSPACE_ROOT_ID || !graph.reach(id)) return;
      const { expandAncestors, activateNode } = get();
      expandAncestors(id);
      // Ensure zoom shows the node: if not under current root, go home
      const visible = get().getVisibleNodes();
      if (!visible.includes(id)) {
        graph.setRootNodeId(useGraphStore.getState().homeRootId);
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

    frameViews: providedFrameViews,

    getVisibleInstances: (host = MAIN_OUTLINE_HOST) => {
      const outline = outlineHostOf(host);
      if (outline === undefined) return [];
      const { nodes, framePages } = get();
      const { rootNodeId, index } = useGraphStore.getState();
      const views = providedFrameViews().map((view) => view.key);
      return collectVisibleInstances(
        outline.root ?? rootNodeId,
        {
          nodes,
          schema: schemaNow(),
          queryDb: index,
          views,
          chain: outline.chain,
          pages: framePages,
        },
        host,
      );
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
      neighborVisibleInstance(get().getVisibleInstances(walkHostOf(instanceKey)), instanceKey, -1),

    getNextVisibleInstance: (instanceKey) =>
      neighborVisibleInstance(get().getVisibleInstances(walkHostOf(instanceKey)), instanceKey, 1),

    getBreadcrumbs: () => {
      const { nodes } = get();
      const { rootNodeId, homeRootId } = useGraphStore.getState();
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
  };
});

/** The selected and active rows that still have a row in `nodes`. */
function keptIds(
  prev: OutlineStateData,
  nodes: NodeMap,
): Pick<OutlineStateData, "selectedNodeId" | "activeNodeId"> {
  return {
    selectedNodeId:
      prev.selectedNodeId !== null && nodes.has(prev.selectedNodeId) ? prev.selectedNodeId : null,
    activeNodeId:
      prev.activeNodeId !== null && nodes.has(prev.activeNodeId) ? prev.activeNodeId : null,
  };
}

/** The focus that survives a graph move to `nodes`: what still has a row there. */
function keptFocus(prev: OutlineStateData, nodes: NodeMap): Partial<OutlineStateData> {
  const { selectedNodeId, activeNodeId } = keptIds(prev, nodes);
  const transientIds = new Set<string>();
  for (const id of prev.transientIds) {
    if (nodes.has(id)) transientIds.add(id);
  }
  return {
    selectedNodeId,
    selectedInstanceKey: selectedNodeId !== null ? prev.selectedInstanceKey : null,
    activeNodeId,
    activeInstanceKey: activeNodeId !== null ? prev.activeInstanceKey : null,
    transientIds,
  };
}

/** The outline's rows re-projected from `next`, keeping the expansion they had. */
function reprojected(prev: OutlineStateData, next: GraphStateData): NodeMap {
  return projectOutline(next, withStoredExpansion(collectExpanded(prev.nodes)), prev.nodes);
}

/**
 * What each graph move leaves of the outline: the rows it reprojects (with
 * which expansion) and the focus that survives. A fresh load keeps nothing; a
 * server resync keeps the rows' own expansion only.
 */
const DERIVED: Record<
  GraphChange,
  (prev: OutlineStateData, next: GraphStateData) => Partial<OutlineStateData>
> = {
  load: (_prev, next) => ({
    nodes: projectOutline(next, loadExpandedIds()),
    ...NO_FOCUS,
    pendingCaret: null,
    transientIds: new Set<string>(),
  }),
  tx: (prev, next) => {
    const nodes = reprojected(prev, next);
    return { nodes, ...keptFocus(prev, nodes) };
  },
  resync: (prev, next) => {
    const nodes = projectOutline(next, collectExpanded(prev.nodes), prev.nodes);
    return { nodes, ...keptFocus(prev, nodes) };
  },
  sync: (prev, next) => {
    const nodes = reprojected(prev, next);
    return { nodes, ...keptIds(prev, nodes) };
  },
  scope: (prev, next) => ({ nodes: reprojected(prev, next), ...NO_FOCUS }),
};

/** Re-derive from `next`, the graph state `change` is about to leave the store in. */
function derive(change: GraphChange, next: GraphStateData): void {
  useOutlineStore.setState(DERIVED[change](useOutlineStore.getState(), next));
}

/**
 * Prune the outgoing active row when it is an empty session transient
 * (r1 §3.3 auto-prune). nextId = incoming focus target; null when focus
 * leaves the outline entirely. The removal is a graph write like any
 * other, so the projection follows it as it follows every write.
 */
function pruneOutgoingTransient(nextId: string | null): void {
  const st = useOutlineStore.getState();
  const out = st.activeNodeId;
  if (out === null || out === nextId) return;
  const node = st.nodes.get(out);
  if (!isPrunableTransient(node, out, st.transientIds, schemaNow())) return;
  useGraphStore.getState().applyTx([], [out]);
}

/** Where navigation lands the focus once the page has moved. */
function arrive(at: "zoom" | "home"): void {
  if (at === "home") {
    useOutlineStore.setState({ ...NO_FOCUS });
    return;
  }
  // The zoom root is the header, not a row, so it cannot hold the
  // selection: row keys and ⌘K would anchor on nothing visible. The
  // selection lands on the first row under it, or nowhere.
  useOutlineStore.setState({ activeNodeId: null, activeInstanceKey: null });
  const first = useOutlineStore.getState().getVisibleInstances()[0] ?? null;
  useOutlineStore.setState({
    selectedNodeId: first?.nodeId ?? null,
    selectedInstanceKey: first?.instanceKey ?? null,
  });
}

provideEditingProjection({ derive, leave: () => pruneOutgoingTransient(null), arrive });

/**
 * The outline as a command drives it (`OutlineCommandApi`), read now: the
 * zoom and scope the page stands at and the graph from the graph store, the
 * selection, projection and editor verbs from this one.
 */
export function outlineCommandApi(): OutlineCommandApi {
  const graph = useGraphStore.getState();
  const outline = useOutlineStore.getState();
  return {
    selectedNodeId: outline.selectedNodeId,
    rootNodeId: graph.rootNodeId,
    ontologyId: graph.ontologyId,
    nodes: outline.nodes,
    wireNodes: graph.wireNodes,
    jumpToNode: outline.jumpToNode,
    zoomTo: graph.zoomTo,
    expandAllInScope: outline.expandAllInScope,
    collapseAllInScope: outline.collapseAllInScope,
    frameViews: outline.frameViews,
  };
}

/**
 * This outline's rows with the graph they project and its index, read now:
 * what a step that knows a row only by id resolves against (`rowTextOf`,
 * `fieldContextOf`).
 */
export function outlineSource(): FieldContextSource {
  const { ontologyId, wireNodes, index } = useGraphStore.getState();
  return { ontologyId, wireNodes, index, nodes: useOutlineStore.getState().nodes };
}

/** What field values resolve against (`fieldContextOf`): the graph's schema and index, this outline. */
export function useFieldContext(): FieldContext {
  const nodes = useOutlineStore((s) => s.nodes);
  const ontologyId = useGraphStore((s) => s.ontologyId);
  const wireNodes = useGraphStore((s) => s.wireNodes);
  const index = useGraphStore((s) => s.index);
  return fieldContextOf({ ontologyId, wireNodes, nodes, index });
}
