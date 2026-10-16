/**
 * The graph as the page stands in it: the replica's state a projection
 * reasons about, how that state moves, and what the page shows of it — the
 * whole snapshot, or under an ontology scope its members hung off the
 * ontology. The shell's graph store holds the state; a projection is handed
 * it at every move (`PageProjection`), so what the page shows is decided here
 * once, for the shell and every projection alike.
 *
 * Scope is a projection, not a sandbox: what the page shows is filtered, while
 * the index and the schema stay the whole graph (r5 §2.5).
 */
import type { WireNode } from "@kb/contracts";
import { listOntologyNodes } from "@kb/model";
import type { SidebarNavItem } from "../components/sidebar-row";
import type { KbIndex } from "../query";
import { wireToOutlineMap } from "./graph-view";
import { schemaOf } from "./schema";
import { type NodeMap, WORKSPACE_ROOT_ID } from "./types";

/**
 * How the replica, or the scope it is read under, moved: what the projection
 * is told, since each move keeps a different part of what it holds.
 *
 * - `load` — a fresh replica (the graph store's `hydrateFromWire`); nothing
 *   carries over.
 * - `tx` — a delta was applied (`applyTx`).
 * - `sync` — the shared local action advanced the index (`syncFromIndex`).
 * - `resync` — a full server snapshot replaced the graph (`refreshFromWire`).
 * - `scope` — the ontology scope was entered or left (`setOntologyScope`).
 */
export type GraphChange = "load" | "tx" | "sync" | "resync" | "scope";

/** The graph state a projection reads: the snapshot, its index, the zoom and the scope. */
export interface PageGraphState {
  readonly wireNodes: WireNode[];
  /** The query replica of the whole graph, whatever the scope. */
  readonly index: KbIndex | null;
  /** The node the page is zoomed to: the root a pane at "/" shows. */
  readonly rootNodeId: string;
  /** Where "home" zooms to: the workspace, or the ontology while scoped. */
  readonly homeRootId: string;
  /** The ontology the page is scoped to, if any. */
  readonly ontologyId: string | null;
  /** The scope's resolved members, while scoped. */
  readonly ontologyMembers: Set<string> | null;
}

/**
 * The page's graph as the shell holds it: its state now, a subscription to
 * its moves, and the moves a projection makes in it beside the zoom.
 */
export interface PageGraphPort {
  readonly state: () => PageGraphState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Whether the page can show `id`, leaving the ontology scope when `id` is
   * outside it: a scope is never a dead end.
   */
  readonly reach: (id: string) => boolean;
  /**
   * The state the page can show `id` in: this one, or this one with the scope
   * left; null when neither shows it. What `reach` moves to, read without
   * moving.
   */
  readonly reached: (id: string) => PageGraphState | null;
  /** Take a row out of the replica, as a local transaction: an empty row an editor minted and left. */
  readonly drop: (id: string) => void;
}

/** What a scope is read from: the snapshot and the scope's resolution. */
export type ScopeSource = Pick<PageGraphState, "wireNodes" | "ontologyId" | "ontologyMembers">;

/**
 * Restrict a wire snapshot to an ontology's members.
 *
 * Each surviving member is cloned with `children` filtered to members only, so
 * a member's non-member children vanish rather than dangling in the outline
 * map. The ontology node itself is kept as the scope ROOT (it is never a
 * member): members not nested under another member hang off it, so the scoped
 * outline has exactly one top and always offers a way back out.
 */
export function scopedWireNodes(
  wireNodes: WireNode[],
  members: Set<string>,
  ontologyId: string,
): WireNode[] {
  const out: WireNode[] = [];
  const memberIds: string[] = [];
  for (const node of wireNodes) {
    if (node.id === ontologyId) continue;
    if (!members.has(node.id)) continue;
    memberIds.push(node.id);
    out.push({
      ...node,
      children: node.children.filter((c) => members.has(c)),
    });
  }
  const onto = wireNodes.find((n) => n.id === ontologyId);
  if (onto) {
    // Members not nested under another member hang off the scope root, so the
    // outline forest has a single visible top: the ontology.
    const nested = new Set<string>();
    for (const n of out) {
      for (const c of n.children) nested.add(c);
    }
    out.unshift({
      ...onto,
      children: memberIds.filter((id) => !nested.has(id)),
    });
  }
  return out;
}

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
 * either way (`lib/schema.ts`), and the index stays the full graph.
 */
export function shownNodesOf(state: ScopeSource): NodeMap {
  if (state.ontologyId === null || state.ontologyMembers === null) return schemaOf(state);
  return scopedViewOf(state, state.ontologyMembers, state.ontologyId).nodes;
}

/** Whether the page can show `id` under its scope: the workspace, or a row of `shownNodesOf`. */
export function inScope(state: ScopeSource, id: string): boolean {
  return id === WORKSPACE_ROOT_ID || shownNodesOf(state).has(id);
}

/**
 * The ontologies the page can be scoped to, for a picker or a sidebar
 * section: the `#ontology` nodes, sorted by the label shown (an unnamed
 * ontology sorts as "Untitled ontology", not as its id).
 */
export function listOntologyItems(wireNodes: WireNode[]): SidebarNavItem[] {
  return listOntologyNodes(wireNodes)
    .map((n) => ({
      id: n.id,
      label: n.text.trim() || "Untitled ontology",
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
