/**
 * The browser's live graph: the replica every projection reads, the write
 * history over it, and where the page stands in it — the zoom root and the
 * ontology scope. It names no projection. The one that edits (the outline)
 * derives its view from this store and holds a focus that navigation moves,
 * so the store asks it, through {@link EditingProjection}, to derive in the
 * same tick as the replica and to let go of and land its focus around a move.
 */
import { create } from "zustand";
import { DatascriptIndex, toast, WORKSPACE_ROOT_ID, type KbIndex } from "@kb/ui-sdk";
import type { ActionInvocation, WireNode } from "@kb/contracts";
import { resolveScope, scopedWireNodes } from "@/lib/ontology-scope";
import { mergeTx } from "@/lib/tx";
import { ingestBrowserTx, installBrowserNodes, replaceBrowserSession } from "@/session/runtime";

const HISTORY_LIMIT = 50;

/** One write, as the inverse-invocation pair that undoes and redoes it. */
interface UndoEntry {
  undo: ActionInvocation[];
  redo: ActionInvocation[];
}

interface GraphState {
  wireNodes: WireNode[];
  /**
   * Query replica of the full graph. Built once in `hydrateFromWire`;
   * `applyTx` is incremental; `rebuild` on snapshot resync. Same instance
   * across ontology scope — scope is a projection, not a sandbox.
   */
  index: KbIndex | null;
  rev: number;
  loadSource: "api" | "fixtures" | null;
  loadError: string | null;
  /** The node the page is zoomed to: the root a pane at "/" shows. */
  rootNodeId: string;
  /** Where "home" zooms to: the workspace, or the ontology while scoped. */
  homeRootId: string;
  /**
   * Active ontology scope (r5 §2.5). When set, what the page shows is
   * restricted to resolved members (`scopedWireOf`); `wireNodes` and `index`
   * stay global so mutations, backlinks, and #query nodes keep honest reach.
   */
  ontologyId: string | null;
  ontologyMembers: Set<string> | null;
  /** Non-fatal resolution warnings (cycle, bad EDN, unknown ref, cap). */
  ontologyWarnings: string[];
  /** rootNodeId to return to when the scope is left. */
  preScopeRootId: string | null;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  hydrateFromWire: (nodes: WireNode[], rev: number, source: "api" | "fixtures") => void;
  /** Apply node-level delta (optimistic edits + WS tx). */
  applyTx: (upserts: WireNode[], deletes: string[], opts?: { rev?: number }) => void;
  /** Re-read the snapshot after the shared local action advanced the existing index. */
  syncFromIndex: () => void;
  /** Full-snapshot resync (rev gap) that preserves zoom and scope. */
  refreshFromWire: (nodes: WireNode[], rev: number) => void;
  setRootNodeId: (id: string) => void;
  /** Enter (id) / leave (null) an ontology scope. */
  setOntologyScope: (id: string | null) => void;
  /**
   * Whether the page can show `id`, leaving the ontology scope when `id` is
   * outside it: a scope is never a dead end.
   */
  reach: (id: string) => boolean;
  zoomTo: (id: string) => void;
  zoomHome: () => void;
  search: (query: string) => Array<{ id: string; text: string }>;
  /** Push an undo entry (trims redo tail). */
  recordUndo: (entry: UndoEntry) => void;
  /** Pop undoStack and move the same inverse-invocation pair to redoStack. */
  applyUndo: () => UndoEntry | null;
  /** Pop redoStack and move the same inverse-invocation pair to undoStack. */
  applyRedo: () => UndoEntry | null;
}

/** Data half of `GraphState` — every member that is not a function. */
export type GraphStateData = {
  [K in keyof GraphState as GraphState[K] extends (...args: never) => unknown
    ? never
    : K]: GraphState[K];
};

export const initialGraphState: GraphStateData = {
  wireNodes: [],
  index: null,
  rev: 0,
  loadSource: null,
  loadError: null,
  rootNodeId: WORKSPACE_ROOT_ID,
  homeRootId: WORKSPACE_ROOT_ID,
  ontologyId: null,
  ontologyMembers: null,
  ontologyWarnings: [],
  preScopeRootId: null,
  undoStack: [],
  redoStack: [],
};

/**
 * How the replica, or the scope it is read under, moved: what a projection
 * deriving from it is told, since each move keeps a different part of what
 * the projection held.
 *
 * - `load` — a fresh replica (`hydrateFromWire`); nothing carries over.
 * - `tx` — a delta was applied (`applyTx`).
 * - `sync` — the shared local action advanced the index (`syncFromIndex`).
 * - `resync` — a full server snapshot replaced the graph (`refreshFromWire`).
 * - `scope` — the ontology scope was entered or left (`setOntologyScope`).
 */
export type GraphChange = "load" | "tx" | "sync" | "resync" | "scope";

/**
 * The projection the page edits through, as this store asks it. It derives
 * its view from the state the store is about to hold, before any reader can
 * see that state, so no reader meets a graph and a view of an older one. It
 * lets go of its focus before the page moves (an empty row it minted is
 * pruned while it is still shown), and lands it once the page has moved:
 * on the first row under a zoom, or nowhere at home.
 */
interface EditingProjection {
  readonly derive: (change: GraphChange, next: GraphStateData) => void;
  readonly leave: () => void;
  readonly arrive: (at: "zoom" | "home") => void;
}

const NO_PROJECTION: EditingProjection = {
  derive: () => undefined,
  leave: () => undefined,
  arrive: () => undefined,
};

let projection: EditingProjection = NO_PROJECTION;

/**
 * Install the editing projection (the outline store does, once it is
 * created). One installed after a graph has loaded derives from it at once,
 * as from a fresh load.
 */
export function provideEditingProjection(next: EditingProjection): void {
  projection = next;
  const state = useGraphStore.getState();
  if (state.index !== null) next.derive("load", state);
}

/** What a scope is read from: the snapshot and the scope's resolution. */
type ScopeSource = Pick<GraphStateData, "wireNodes" | "ontologyId" | "ontologyMembers">;

let lastScoped: { source: ScopeSource; wire: WireNode[] } | null = null;

/**
 * What the page shows of the graph: the whole snapshot, or under a scope its
 * members hung off the ontology (`scopedWireNodes`). The one array a
 * projection projects, so what the scope shows is decided once.
 */
export function scopedWireOf(state: ScopeSource): WireNode[] {
  if (state.ontologyId === null || state.ontologyMembers === null) return state.wireNodes;
  const last = lastScoped;
  if (
    last !== null &&
    last.source.wireNodes === state.wireNodes &&
    last.source.ontologyId === state.ontologyId &&
    last.source.ontologyMembers === state.ontologyMembers
  ) {
    return last.wire;
  }
  const wire = scopedWireNodes(state.wireNodes, state.ontologyMembers, state.ontologyId);
  lastScoped = { source: state, wire };
  return wire;
}

const scopedIds = new WeakMap<WireNode[], Set<string>>();

/** Whether the page can show `id` under its scope: the workspace, or a node of `scopedWireOf`. */
function inScope(state: ScopeSource, id: string): boolean {
  if (id === WORKSPACE_ROOT_ID) return true;
  const wire = scopedWireOf(state);
  let ids = scopedIds.get(wire);
  if (ids === undefined) {
    ids = new Set(wire.map((n) => n.id));
    scopedIds.set(wire, ids);
  }
  return ids.has(id);
}

/** The resolution of scope `ontologyId` over `wire`, as the state holds it. */
function scopeFields(
  wire: WireNode[],
  ontologyId: string | null,
  index: KbIndex,
): Pick<GraphStateData, "ontologyMembers" | "ontologyWarnings"> {
  if (ontologyId === null) return { ontologyMembers: null, ontologyWarnings: [] };
  const resolution = resolveScope(wire, ontologyId, index, index.generation);
  return { ontologyMembers: resolution.members, ontologyWarnings: resolution.warnings };
}

/** Deleted nodes must not remain the zoom root. */
function clampedRoot(next: ScopeSource, prev: GraphStateData): string {
  return inScope(next, prev.rootNodeId) ? prev.rootNodeId : prev.homeRootId;
}

function now(): GraphState {
  return useGraphStore.getState();
}

/** Move to `patch` by `change`: the projection derives from it first, then readers see it. */
function moveTo(change: GraphChange, patch: Partial<GraphStateData>): void {
  projection.derive(change, { ...now(), ...patch });
  useGraphStore.setState(patch);
}

// The replica's moves.

function hydrateFromWire(wireNodes: WireNode[], rev: number, source: "api" | "fixtures"): void {
  // A fresh load starts unscoped; App re-applies the URL scope after.
  const index = new DatascriptIndex(wireNodes);
  replaceBrowserSession(wireNodes, rev, index, {
    onLocalCommit: syncFromIndex,
    applyServerTx: (tx, txRev) => applyTx(tx.upserts, tx.deletes, { rev: txRev }),
    installServerSnapshot: (nodes, snapshotRev) => refreshFromWire(nodes, snapshotRev),
  });
  moveTo("load", {
    wireNodes,
    index,
    rev,
    loadSource: source,
    loadError: null,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    ontologyId: null,
    ontologyMembers: null,
    ontologyWarnings: [],
    preScopeRootId: null,
    undoStack: [],
    redoStack: [],
  });
}

function applyTx(upserts: WireNode[], deletes: string[], opts?: { rev?: number }): void {
  const prev = now();
  ingestBrowserTx({ upserts, deletes });
  const wireNodes = mergeTx(prev.wireNodes, upserts, deletes);
  const index = prev.index ?? new DatascriptIndex(wireNodes);
  const scope = scopeFields(wireNodes, prev.ontologyId, index);
  const next = { wireNodes, ontologyId: prev.ontologyId, ...scope };
  moveTo("tx", { ...next, index, rev: opts?.rev ?? prev.rev, rootNodeId: clampedRoot(next, prev) });
}

function syncFromIndex(): void {
  const prev = now();
  if (prev.index === null) return;
  const wireNodes = prev.index.storedNodes();
  const scope = scopeFields(wireNodes, prev.ontologyId, prev.index);
  const next = { wireNodes, ontologyId: prev.ontologyId, ...scope };
  moveTo("sync", { ...next, rootNodeId: clampedRoot(next, prev) });
}

function refreshFromWire(wireNodes: WireNode[], rev: number): void {
  const prev = now();
  const index = prev.index ?? new DatascriptIndex(wireNodes);
  if (prev.index !== null) installBrowserNodes(wireNodes);
  const scope = scopeFields(wireNodes, prev.ontologyId, index);
  const next = { wireNodes, ontologyId: prev.ontologyId, ...scope };
  moveTo("resync", { ...next, index, rev, rootNodeId: clampedRoot(next, prev) });
}

// Where the page stands: the scope and the zoom.

function setOntologyScope(id: string | null): void {
  if (now().ontologyId === id) return;
  projection.leave();
  const st = now();
  const index = st.index ?? new DatascriptIndex(st.wireNodes);
  const scope = scopeFields(st.wireNodes, id, index);

  if (id === null) {
    // Leaving: return to the root the user was on before entering.
    const restored =
      st.preScopeRootId !== null &&
      inScope({ wireNodes: st.wireNodes, ontologyId: null, ...scope }, st.preScopeRootId)
        ? st.preScopeRootId
        : WORKSPACE_ROOT_ID;
    moveTo("scope", {
      ontologyId: null,
      ...scope,
      preScopeRootId: null,
      rootNodeId: restored,
      homeRootId: WORKSPACE_ROOT_ID,
    });
    return;
  }

  // Entering: the ontology becomes both the zoom root and home, so an
  // exit path always exists even if the previous root is not a member.
  moveTo("scope", {
    ontologyId: id,
    ...scope,
    preScopeRootId: st.ontologyId === null ? st.rootNodeId : st.preScopeRootId,
    rootNodeId: id,
    homeRootId: id,
  });
}

function reach(id: string): boolean {
  const st = now();
  if (inScope(st, id)) return true;
  if (st.ontologyId === null) return false;
  if (!st.wireNodes.some((n) => n.id === id)) return false;
  setOntologyScope(null);
  toast("Left the ontology to follow that node");
  return inScope(now(), id);
}

function zoomTo(id: string): void {
  if (!reach(id)) return;
  projection.leave();
  useGraphStore.setState({ rootNodeId: id });
  projection.arrive("zoom");
}

function zoomHome(): void {
  projection.leave();
  useGraphStore.setState({ rootNodeId: now().homeRootId });
  projection.arrive("home");
}

function search(query: string): Array<{ id: string; text: string }> {
  const st = now();
  if (st.index === null) return [];
  const q = query.trim();
  if (!q) return [];
  return st.index
    .search(q, 50)
    .filter((n) => inScope(st, n.id))
    .map((n) => ({ id: n.id, text: n.text }));
}

// The write history.

function recordUndo(entry: UndoEntry): void {
  useGraphStore.setState((s) => ({
    undoStack: [...s.undoStack.slice(-(HISTORY_LIMIT - 1)), entry],
    redoStack: [],
  }));
}

function applyUndo(): UndoEntry | null {
  const st = now();
  const entry = st.undoStack[st.undoStack.length - 1];
  if (!entry) return null;
  useGraphStore.setState((s) => ({
    undoStack: s.undoStack.slice(0, -1),
    redoStack: [...s.redoStack.slice(-(HISTORY_LIMIT - 1)), entry],
  }));
  return entry;
}

function applyRedo(): UndoEntry | null {
  const st = now();
  const entry = st.redoStack[st.redoStack.length - 1];
  if (!entry) return null;
  useGraphStore.setState((s) => ({
    redoStack: s.redoStack.slice(0, -1),
    undoStack: [...s.undoStack.slice(-(HISTORY_LIMIT - 1)), entry],
  }));
  return entry;
}

export const useGraphStore = create<GraphState>((set) => ({
  ...initialGraphState,
  hydrateFromWire,
  applyTx,
  syncFromIndex,
  refreshFromWire,
  setRootNodeId: (id) => set({ rootNodeId: id }),
  setOntologyScope,
  reach,
  zoomTo,
  zoomHome,
  search,
  recordUndo,
  applyUndo,
  applyRedo,
}));
