/**
 * The browser's live graph: the replica every projection reads, the write
 * history over it, and where the page stands in it — the zoom root and the
 * ontology scope, and what the scope shows (`scopedWireOf`, `shownNodesOf`).
 * It names no projection. The projection the page stands in reads its rows
 * from this store, so they are never out of step with it; what the
 * projection holds of its own — which rows are open, and its focus — follows
 * each move through {@link PageProjection}, the port a plugin installs.
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import {
  DatascriptIndex,
  schemaOf,
  toast,
  wireToOutlineMap,
  WORKSPACE_ROOT_ID,
  type KbIndex,
  type NodeMap,
  type OutlineNode,
} from "@kb/ui-sdk";
import { portSlot } from "@/stores/port-slot";
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
 * How the replica, or the scope it is read under, moved: what the projection
 * is told, since each move keeps a different part of what it holds.
 *
 * - `load` — a fresh replica (`hydrateFromWire`); nothing carries over.
 * - `tx` — a delta was applied (`applyTx`).
 * - `sync` — the shared local action advanced the index (`syncFromIndex`).
 * - `resync` — a full server snapshot replaced the graph (`refreshFromWire`).
 * - `scope` — the ontology scope was entered or left (`setOntologyScope`).
 */
export type GraphChange = "load" | "tx" | "sync" | "resync" | "scope";

/**
 * The projection the page stands in: what any projection the page is shown
 * and edited through offers the shell. Core names none; a plugin installs
 * one while it is loaded (`providePageProjection`). Its rows are read from
 * this store, so it holds only its own state, such as which rows are open.
 * Its editor (the caret, the text hosts, the selection) is a port of its
 * own (`stores/page-editor.ts`).
 *
 * Told of a move, for every member of that kind:
 *
 * - It is told before this store moves, and is handed every graph state it
 *   reasons about. It reads none from this store, which may still hold the
 *   state being left.
 * - It moves its own state to one valid against both the state it is handed
 *   and the one the store holds, so a reader told in between sees nothing out
 *   of step. Then this store moves, in one write.
 *
 * The members:
 *
 * - `follow(change, prev, next)` — the replica or scope moves from `prev` to
 *   `next`;
 * - `leave(from)` — the page is about to leave `from`: let go of the focus.
 *   An empty row it minted is pruned while `from` still shows it, as a graph
 *   write of its own;
 * - `arrive(at, to)` — the page is about to stand at `to`, zoomed to
 *   `to.rootNodeId`: land the focus there;
 * - `subscribe(listener)` — a change to what it holds of its own;
 * - `rows(graph)` — the rows it shows of `graph`: what the page shows
 *   (`shownNodesOf`), each open or closed as it holds them;
 * - `reveal(id)` — show `id` where the page is edited, moving the page if it
 *   must, and edit it: a follow's "reveal", a palette hit, an ontology
 *   member.
 */
export interface PageProjection {
  readonly follow: (change: GraphChange, prev: GraphStateData, next: GraphStateData) => void;
  readonly leave: (from: GraphStateData) => void;
  readonly arrive: (at: "zoom" | "home", to: GraphStateData) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly rows: (graph: ScopeSource) => NodeMap;
  readonly reveal: (id: string) => void;
}

/**
 * What the page stands in while no projection is installed: one that holds
 * nothing of its own, so it shows the rows at their default collapse and
 * reveals nothing. A stand-in projection spreads it for the members it does
 * not watch.
 */
export const EMPTY_PROJECTION: PageProjection = {
  follow: () => undefined,
  leave: () => undefined,
  arrive: () => undefined,
  subscribe: () => () => undefined,
  rows: (graph) => shownNodesOf(graph),
  reveal: () => undefined,
};

const installed = portSlot<PageProjection>(EMPTY_PROJECTION);

/** The projection the page stands in now: the installed one, else {@link EMPTY_PROJECTION}. */
export const pageProjection = installed.current;

/** Listen for a change to what the projection holds of its own, or to which one is installed. */
export const subscribeProjection = installed.subscribe;

/**
 * Install the page's projection, from the plugin that provides it while it is
 * loaded. With none installed the graph moves on its own: no one is told, and
 * what a withdrawn projection holds of its own stays as it was. One installed
 * after a graph has loaded follows it at once, as a fresh load: its expansion
 * is read again from storage, and its focus and transient rows start empty.
 * Installing the one already installed does nothing.
 */
export function providePageProjection(next: PageProjection): void {
  if (pageProjection() === next) return;
  installed.install(next);
  const state = useGraphStore.getState();
  if (state.index !== null) next.follow("load", state, state);
}

/**
 * Uninstall `leaving`, if it is still the one this store tells. It leaves
 * the page first, as a page move does, so an empty row it minted is pruned
 * rather than left behind.
 */
export function withdrawPageProjection(leaving: PageProjection): void {
  if (pageProjection() !== leaving) return;
  leaving.leave(now());
  installed.withdraw(leaving);
}

/** What a scope is read from: the snapshot and the scope's resolution. */
export type ScopeSource = Pick<GraphStateData, "wireNodes" | "ontologyId" | "ontologyMembers">;

/** What the last scoped snapshot shows: its wire and its rows (the one cache of a scope's view). */
let lastScoped: { source: ScopeSource; wire: WireNode[]; nodes: NodeMap } | null = null;

/** What scoped `state` shows, built once per scoped snapshot, keeping the last one's unchanged rows. */
function scopedViewOf(
  state: ScopeSource,
  members: Set<string>,
  ontologyId: string,
): { readonly source: ScopeSource; readonly wire: WireNode[]; readonly nodes: NodeMap } {
  const last = lastScoped;
  if (
    last !== null &&
    last.source.wireNodes === state.wireNodes &&
    last.source.ontologyId === state.ontologyId &&
    last.source.ontologyMembers === state.ontologyMembers
  ) {
    return last;
  }
  const wire = scopedWireNodes(state.wireNodes, members, ontologyId);
  const nodes = wireToOutlineMap(wire, new Set(), state.wireNodes, last ? [last.nodes] : []);
  lastScoped = { source: state, wire, nodes };
  return lastScoped;
}

/**
 * What the page shows of the graph: the whole snapshot, or under a scope its
 * members hung off the ontology (`scopedWireNodes`). The one array a
 * projection projects, so what the scope shows is decided once.
 */
export function scopedWireOf(state: ScopeSource): WireNode[] {
  if (state.ontologyId === null || state.ontologyMembers === null) return state.wireNodes;
  return scopedViewOf(state, state.ontologyMembers, state.ontologyId).wire;
}

/**
 * What the page shows of the graph as rows, at default collapse: the schema
 * itself unscoped (`schemaOf`), else the scope's projection of
 * `scopedWireOf`. Schema and tag palette resolve against the whole graph
 * either way (`lib/schema.ts`), and the index stays the full graph: scope is
 * a projection, not a sandbox (r5 §2.5).
 */
export function shownNodesOf(state: ScopeSource): NodeMap {
  if (state.ontologyId === null || state.ontologyMembers === null) return schemaOf(state);
  return scopedViewOf(state, state.ontologyMembers, state.ontologyId).nodes;
}

/** What the page shows of the graph now (`shownNodesOf`), each row at its default collapse. */
export function shownNodes(): NodeMap {
  return shownNodesOf(useGraphStore.getState());
}

/**
 * What the page shows of the graph, read by this component: for a reader of
 * what a row says (its text, its props), never of whether it is open.
 */
export function useShownNodes(): NodeMap {
  return useSyncExternalStore(useGraphStore.subscribe, shownNodes, shownNodes);
}

/** One node of what the page shows: this component re-renders when that node changes. */
export function useShownNode(id: string | null): OutlineNode | undefined {
  const read = () => (id === null ? undefined : shownNodes().get(id));
  return useSyncExternalStore(useGraphStore.subscribe, read, read);
}

/** Whether the page can show `id` under its scope: the workspace, or a row of `shownNodesOf`. */
export function inScope(state: ScopeSource, id: string): boolean {
  return id === WORKSPACE_ROOT_ID || shownNodesOf(state).has(id);
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

/** Move to `patch` by `change`: the projection follows first, then the store moves once. */
function moveTo(change: GraphChange, patch: Partial<GraphStateData>): void {
  const prev = now();
  pageProjection().follow(change, prev, { ...prev, ...patch });
  useGraphStore.setState(patch);
}

/**
 * Replace the whole graph state with `next`, as a load the projection follows:
 * how a test stands a fresh, unloaded graph up.
 */
export function replaceGraph(next: GraphStateData): void {
  pageProjection().follow("load", now(), next);
  useGraphStore.setState(next);
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
  moveTo("tx", {
    ...next,
    index,
    rev: opts?.rev ?? prev.rev,
    rootNodeId: clampedRoot(next, prev),
  });
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
  pageProjection().leave(now());
  moveTo("scope", scopeMove(now(), id));
}

/** Where scope `id` (or none) puts the page from `st`. */
function scopeMove(st: GraphStateData, id: string | null): Partial<GraphStateData> {
  const index = st.index ?? new DatascriptIndex(st.wireNodes);
  const scope = scopeFields(st.wireNodes, id, index);
  if (id === null) {
    // Leaving: return to the root the user was on before entering.
    const restored =
      st.preScopeRootId !== null &&
      inScope({ wireNodes: st.wireNodes, ontologyId: null, ...scope }, st.preScopeRootId)
        ? st.preScopeRootId
        : WORKSPACE_ROOT_ID;
    return {
      ontologyId: null,
      ...scope,
      preScopeRootId: null,
      rootNodeId: restored,
      homeRootId: WORKSPACE_ROOT_ID,
    };
  }
  // Entering: the ontology becomes both the zoom root and home, so an
  // exit path always exists even if the previous root is not a member.
  return {
    ontologyId: id,
    ...scope,
    preScopeRootId: st.ontologyId === null ? st.rootNodeId : st.preScopeRootId,
    rootNodeId: id,
    homeRootId: id,
  };
}

/**
 * How the page reaches `id` from `st`: it shows it already (`"shown"`), it
 * leaves the scope (that move), or no scope shows it (null). Derived once;
 * `reach` makes the move and `reachedState` reads where it lands.
 */
function reachMove(st: GraphStateData, id: string): "shown" | Partial<GraphStateData> | null {
  if (inScope(st, id)) return "shown";
  if (st.ontologyId === null || !st.wireNodes.some((n) => n.id === id)) return null;
  const move = scopeMove(st, null);
  return inScope({ ...st, ...move }, id) ? move : null;
}

/**
 * The graph state in which the page can show `id`: this one, or this one with
 * the scope left when `id` is outside it; null when neither shows it. What
 * `reach` moves to, read without moving.
 */
export function reachedState(id: string): GraphStateData | null {
  const st = now();
  const move = reachMove(st, id);
  if (move === null) return null;
  return move === "shown" ? st : { ...st, ...move };
}

function reach(id: string): boolean {
  const move = reachMove(now(), id);
  if (move === null) return false;
  if (move === "shown") return true;
  pageProjection().leave(now());
  moveTo("scope", move);
  toast("Left the ontology to follow that node");
  return true;
}

/**
 * Stand the page at `rootNodeId`: the projection lets go of where the page
 * is, then lands at where it will be, then this store moves, in one write.
 */
function standAt(at: "zoom" | "home", rootNodeId: string): void {
  pageProjection().leave(now());
  pageProjection().arrive(at, { ...now(), rootNodeId });
  useGraphStore.setState({ rootNodeId });
}

function zoomTo(id: string): void {
  if (!reach(id)) return;
  standAt("zoom", id);
}

function zoomHome(): void {
  standAt("home", now().homeRootId);
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

export const useGraphStore = create<GraphState>()(() => ({
  ...initialGraphState,
  hydrateFromWire,
  applyTx,
  syncFromIndex,
  refreshFromWire,
  setOntologyScope,
  reach,
  zoomTo,
  zoomHome,
  search,
  recordUndo,
  applyUndo,
  applyRedo,
}));
