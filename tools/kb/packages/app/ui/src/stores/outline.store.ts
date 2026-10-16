/**
 * The outline editor's state: which rows the reader opened or closed, the row
 * being edited and the row selected, the caret hand-off, the text-host
 * registry, the rows it minted empty, and the pages its frames reveal. The
 * graph, the zoom root and the scope are the graph store's
 * (`stores/graph.store.ts`).
 *
 * The outline's rows are not stored. They are derived when read
 * (`outlineNodes`): what the page shows of the graph at default collapse (the
 * schema, or a scope's projection), opened and closed by this store's
 * `expansion`. So no reader can see the rows of one snapshot beside another
 * snapshot: there is one copy of the graph, and the rows are a view of it.
 */
import { useSyncExternalStore } from "react";
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
  withExpansion,
  WORKSPACE_ROOT_ID,
  type CaretIntent,
  type Expansion,
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
import type { WireNode } from "@kb/contracts";
import { providedFrameViews } from "@/stores/frame-views";
import {
  scopedWireOf,
  useGraphStore,
  type EditingProjection,
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
  /** Which rows the reader opened or closed; the rows themselves are `outlineNodes()`. */
  expansion: Expansion;
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
  expansion: new Map(),
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

/** The rows `expansion` opens: what storage keeps across a reload. */
function openIds(expansion: Expansion): Set<string> {
  const ids = new Set<string>();
  for (const [id, open] of expansion) if (open) ids.add(id);
  return ids;
}

/** The expansion kept in storage: every row it names is open. */
function storedExpansion(): Expansion {
  return new Map([...loadExpandedIds()].map((id) => [id, true] as const));
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

/** What the outline shows of the graph is read from: the snapshot and its scope. */
type ShownSource = Pick<GraphStateData, "wireNodes" | "ontologyId" | "ontologyMembers">;

/** The last scope projection built: the next keeps its unchanged rows. */
let lastScoped: { readonly wire: WireNode[]; readonly map: NodeMap } | null = null;

/**
 * What the page shows of `graph`, at default collapse: the single place a
 * graph state becomes the outline's rows.
 *
 * Unscoped, that is the schema itself (`schemaOf`), the one whole-graph map a
 * snapshot has. Under a scope it is the scope's own projection of
 * `scopedWireOf`, built once per scoped snapshot. The index stays the FULL
 * graph either way — scope is a projection, not a sandbox, so backlinks,
 * `#query` nodes and WS subscriptions keep global reach (r5 §2.5) — and the
 * schema and tag palette are resolved against the whole graph
 * (`lib/schema.ts`).
 */
function shownOf(graph: ShownSource): NodeMap {
  const shown = scopedWireOf(graph);
  if (shown === graph.wireNodes) return schemaOf(graph);
  if (lastScoped?.wire === shown) return lastScoped.map;
  const map = wireToOutlineMap(shown, new Set(), graph.wireNodes, lastScoped?.map);
  lastScoped = { wire: shown, map };
  return map;
}

let lastRows: { readonly base: NodeMap; readonly expansion: Expansion; rows: NodeMap } | null =
  null;

/** The outline's rows over `graph`: what it shows, as `expansion` opens it. */
function rowsOf(graph: ShownSource, expansion: Expansion): NodeMap {
  const base = shownOf(graph);
  if (lastRows?.base === base && lastRows.expansion === expansion) return lastRows.rows;
  const rows = withExpansion(base, expansion);
  lastRows = { base, expansion, rows };
  return rows;
}

/**
 * The outline's rows now. The same value until the graph, its scope, or the
 * expansion moves; a row keeps its object for as long as what it shows does.
 */
export function outlineNodes(): NodeMap {
  return rowsOf(useGraphStore.getState(), useOutlineStore.getState().expansion);
}

/** Listen for every change `outlineNodes` can follow: the graph's and this store's. */
export function subscribeOutline(listener: () => void): () => void {
  const fromGraph = useGraphStore.subscribe(listener);
  const fromOutline = useOutlineStore.subscribe(listener);
  return () => {
    fromGraph();
    fromOutline();
  };
}

/** The outline's rows, read by this component: it re-renders when they change. */
export function useOutlineNodes(): NodeMap {
  return useSyncExternalStore(subscribeOutline, outlineNodes, outlineNodes);
}

/** One row of the outline: this component re-renders when that row changes. */
export function useOutlineNode(id: string | null): OutlineNode | undefined {
  const read = () => (id === null ? undefined : outlineNodes().get(id));
  return useSyncExternalStore(subscribeOutline, read, read);
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

export const useOutlineStore = create<OutlineState>()((set, get) => {
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

  /** Record the reader's open (true) or closed (false) choice for each row named. */
  function choose(choices: Iterable<readonly [string, boolean]>): void {
    const current = get().expansion;
    let next: Map<string, boolean> | null = null;
    for (const [id, open] of choices) {
      if (current.get(id) === open) continue;
      next ??= new Map(current);
      next.set(id, open);
    }
    if (next === null) return;
    saveExpandedIds(openIds(next));
    set({ expansion: next });
  }

  return {
    ...initialOutlineState,

    activateNode: (id, cursorPos, instanceKey, opts) => {
      if (!outlineNodes().has(id)) return;
      // A row whose text cannot be written is read-only at the DOM level:
      // activation degrades to selection so no caret ever enters it (r1 D20).
      // `rowTextReadOnlyReason` owns which rows those are — sys.* text, and a
      // contextual reference whose target is gone.
      if (rowTextReadOnlyReason(id, outlineNodes().get(id), schemaNow()) !== null) {
        // The outline being worked in is the one the focus is leaving.
        const roKey = resolveActivateKey(
          id,
          instanceKey,
          outlineNodes(),
          get().selectedInstanceKey,
        );
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
      const key = resolveActivateKey(id, instanceKey, outlineNodes(), revealed.selectedInstanceKey);
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
      const nodes = outlineNodes();
      const { selectedInstanceKey } = get();
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
      const node = outlineNodes().get(id);
      if (!node || !isExpandableOutlineNode(node, schemaNow())) return;
      choose([[id, node.collapsed]]);
    },

    expandAllInScope: () => {
      const nodes = outlineNodes();
      const schema = schemaNow();
      const open: Array<readonly [string, boolean]> = [];
      for (const id of scopeNodeIds(nodes, useGraphStore.getState().rootNodeId)) {
        const node = nodes.get(id);
        if (node?.collapsed === true && isExpandableOutlineNode(node, schema))
          open.push([id, true]);
      }
      choose(open);
    },

    collapseAllInScope: () => {
      const nodes = outlineNodes();
      const schema = schemaNow();
      const closed: Array<readonly [string, boolean]> = [];
      for (const id of scopeNodeIds(nodes, useGraphStore.getState().rootNodeId)) {
        const node = nodes.get(id);
        if (node?.collapsed === false && isExpandableOutlineNode(node, schema)) {
          closed.push([id, false]);
        }
      }
      choose(closed);
    },

    expandAncestors: (id) => {
      const nodes = outlineNodes();
      const open: Array<readonly [string, boolean]> = [];
      let current: OutlineNode | undefined = nodes.get(id);
      while (current !== undefined && current.parentId !== null) {
        const parent = nodes.get(current.parentId);
        if (!parent) break;
        if (parent.collapsed) open.push([parent.id, true]);
        current = parent;
      }
      choose(open);
    },

    jumpToNode: (id) => {
      if (id === WORKSPACE_ROOT_ID || !useGraphStore.getState().reach(id)) return;
      get().expandAncestors(id);
      // The row being edited is shown where it is edited: nothing moves.
      if (get().activeNodeId !== id) {
        const { rootNodeId, homeRootId } = useGraphStore.getState();
        const shows = (root: string) =>
          visibleInstancesOf(MAIN_OUTLINE_HOST, root).some((row) => row.nodeId === id);
        // Not under the zoom root: the page goes home to show it. Whether
        // it shows there is checked before the page lets go of anything.
        if (!shows(rootNodeId)) {
          if (!shows(homeRootId)) {
            toast("That node is not visible in this outline");
            return;
          }
          useGraphStore.getState().zoomHome();
        }
      }
      const key = outlineInstanceKey(id, outlineNodes());
      get().activateNode(id, 0, key);
      // scroll into view after paint — instance key beats bare nodeId
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-instance-key="${CSS.escape(key)}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },

    frameViews: providedFrameViews,

    getVisibleInstances: (host = MAIN_OUTLINE_HOST) =>
      visibleInstancesOf(host, useGraphStore.getState().rootNodeId),

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
      const nodes = outlineNodes();
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
  const kept = [...prev.transientIds].filter((id) => nodes.has(id));
  return {
    selectedNodeId,
    selectedInstanceKey: selectedNodeId !== null ? prev.selectedInstanceKey : null,
    activeNodeId,
    activeInstanceKey: activeNodeId !== null ? prev.activeInstanceKey : null,
    transientIds: kept.length === prev.transientIds.size ? prev.transientIds : new Set(kept),
  };
}

/**
 * The expansion kept across a move from `from` to `to` (both at default
 * collapse): a row shown open stays open when the move makes its default
 * collapsed — it gained children or fields while the reader looked at it.
 */
function keptOpen(expansion: Expansion, from: NodeMap, to: NodeMap): Expansion {
  let kept: Map<string, boolean> | null = null;
  for (const [id, node] of to) {
    if (!node.collapsed || expansion.has(id)) continue;
    if (from.get(id)?.collapsed !== false) continue;
    kept ??= new Map(expansion);
    kept.set(id, true);
  }
  return kept ?? expansion;
}

/** The focus each move other than a fresh load keeps: what still has a row, or none at a scope. */
const KEPT_FOCUS: Record<
  Exclude<GraphChange, "load">,
  (prev: OutlineStateData, to: NodeMap) => Partial<OutlineStateData>
> = {
  tx: keptFocus,
  resync: keptFocus,
  sync: keptIds,
  scope: () => NO_FOCUS,
};

/**
 * Move the outline's own state for a graph move from `prev` to `next`, before
 * the graph store moves. A fresh load keeps nothing and reads the expansion
 * from storage. Every other move keeps the expansion (`keptOpen`) and the
 * focus its kind keeps (`KEPT_FOCUS`). What it keeps is valid against both
 * states: the focus kept is on rows `next` still shows and `prev` showed, and
 * the rows it keeps open already showed open in `prev`.
 */
function follow(change: GraphChange, prev: GraphStateData, next: GraphStateData): void {
  if (change === "load") {
    useOutlineStore.setState({
      expansion: storedExpansion(),
      ...NO_FOCUS,
      pendingCaret: null,
      transientIds: new Set<string>(),
    });
    return;
  }
  const outline = useOutlineStore.getState();
  const to = shownOf(next);
  useOutlineStore.setState({
    expansion: keptOpen(outline.expansion, shownOf(prev), to),
    ...KEPT_FOCUS[change](outline, to),
  });
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
  const node = outlineNodes().get(out);
  if (!isPrunableTransient(node, out, st.transientIds, schemaNow())) return;
  useGraphStore.getState().applyTx([], [out]);
}

/** The rows outline host `host` draws when the page is zoomed to `pageRoot`. */
function visibleInstancesOf(host: string, pageRoot: string): VisibleInstance[] {
  const outline = outlineHostOf(host);
  if (outline === undefined) return [];
  const views = providedFrameViews().map((view) => view.key);
  return collectVisibleInstances(
    outline.root ?? pageRoot,
    {
      nodes: outlineNodes(),
      schema: schemaNow(),
      queryDb: useGraphStore.getState().index,
      views,
      chain: outline.chain,
      pages: useOutlineStore.getState().framePages,
    },
    host,
  );
}

/**
 * Where navigation lands the focus, before the page moves to `root`: nowhere
 * at home, and at a zoom on the first row under it. The zoom root is the
 * header, not a row, so it cannot hold the selection: row keys and ⌘K would
 * anchor on nothing visible.
 */
function arrive(at: "zoom" | "home", root: string): void {
  if (at === "home") {
    useOutlineStore.setState({ ...NO_FOCUS });
    return;
  }
  const first = visibleInstancesOf(MAIN_OUTLINE_HOST, root)[0] ?? null;
  useOutlineStore.setState({
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: first?.nodeId ?? null,
    selectedInstanceKey: first?.instanceKey ?? null,
  });
}

/**
 * The outline as the graph store's editing projection: installed by the
 * outline plugin while it is loaded (`provideEditingProjection`).
 */
export const outlineProjection: EditingProjection = {
  follow,
  leave: () => pruneOutgoingTransient(null),
  arrive,
};

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
    nodes: outlineNodes(),
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
  const graph = useGraphStore.getState();
  return { schema: schemaOf(graph), index: graph.index, nodes: outlineNodes() };
}

/** What field values resolve against (`fieldContextOf`): the graph's schema and index, this outline. */
export function useFieldContext(): FieldContext {
  const nodes = useOutlineNodes();
  const schema = useGraphStore(schemaOf);
  const index = useGraphStore((s) => s.index);
  return fieldContextOf({ schema, nodes, index });
}
