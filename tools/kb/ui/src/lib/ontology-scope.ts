/**
 * Ontology scope — "when you use an ontology, you only see nodes of such
 * ontology and how they're connected."
 *
 * Scope is a PROJECTION, not a sandbox. The outline is projected through one
 * function (`wireToOutlineMap`), so filtering the array handed to it scopes the
 * outline, search, keyboard nav, and breadcrumbs at once. `queryDb` stays built
 * over the FULL wire set on purpose: backlinks, `#query` nodes, and WS
 * subscriptions keep global reach and honest results. Scoping the datalog
 * engine is deliberately out of core (r5 §2.9).
 */
import type { WireNode } from "@kb/protocol";
import {
  listOntologyNodes,
  resolveOntology,
  type MemberReason,
  type OntologyResolution,
} from "@kb/ontology";
import type { QueryDb } from "@/ds/db";
import { runQuery } from "@/ds/query";
import type { NodeMap, OutlineNode } from "@/lib/types";

export type { MemberReason, OntologyResolution };

export interface OntologyNavItem {
  id: string;
  label: string;
}

/**
 * `#ontology` nodes for the picker / sidebar, sorted by the label actually
 * shown (an unnamed ontology sorts as "Untitled ontology", not as its id).
 */
export function listOntologyItems(wireNodes: WireNode[]): OntologyNavItem[] {
  return listOntologyNodes(wireNodes)
    .map((n) => ({
      id: n.id,
      label: n.text.trim() || "Untitled ontology",
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

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

/**
 * Memoized per snapshot IDENTITY, not per `rev`.
 *
 * `rev` is the server's counter and does NOT move for a local optimistic edit,
 * so keying on it alone would serve stale membership the moment you add an
 * include tag. Every store transition mints a fresh `wireNodes` array, which
 * makes the array itself the exact key; a WeakMap keeps it leak-free.
 */
const scopeCache = new WeakMap<
  readonly WireNode[],
  Map<string, OntologyResolution>
>();

/**
 * Resolve membership for a scope.
 *
 * The client datalog runner takes no inputs, so `sys.f.onto.query` must be
 * parameter-free EDN — same contract as every other client-side query in kb.
 * `rev` joins the key only so a same-array resync still re-resolves.
 */
export function resolveScope(
  wireNodes: WireNode[],
  ontologyId: string,
  queryDb: QueryDb | null,
  rev: number,
): OntologyResolution {
  const key = `${rev}\u0000${ontologyId}`;
  let perSnapshot = scopeCache.get(wireNodes);
  if (!perSnapshot) {
    perSnapshot = new Map<string, OntologyResolution>();
    scopeCache.set(wireNodes, perSnapshot);
  }
  const hit = perSnapshot.get(key);
  if (hit) return hit;
  const resolution = resolveOntology(wireNodes, ontologyId, {
    runQuery: queryDb ? (edn) => runQuery(queryDb, edn) : undefined,
  });
  perSnapshot.set(key, resolution);
  return resolution;
}

export interface MemberRowModel {
  id: string;
  label: string;
  reasons: MemberReason[];
  /** True when the member is pinned via sys.f.onto.member. */
  pinned: boolean;
}

/** Member rows for the ontology page, sorted by label then id. */
export function memberRows(
  resolution: OntologyResolution,
  nodes: NodeMap,
): MemberRowModel[] {
  const rows: MemberRowModel[] = [];
  for (const id of resolution.members) {
    const reasons = resolution.reasons.get(id) ?? [];
    rows.push({
      id,
      label: labelOf(id, nodes),
      reasons,
      pinned: reasons.some((r) => r.kind === "member"),
    });
  }
  return rows.sort(
    (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
}

/** Excluded rows for the ontology page ("restore" candidates). */
export function excludedRows(
  resolution: OntologyResolution,
  nodes: NodeMap,
): MemberRowModel[] {
  return [...resolution.excluded]
    .map((id) => ({
      id,
      label: labelOf(id, nodes),
      reasons: [] as MemberReason[],
      pinned: false,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function labelOf(id: string, nodes: NodeMap): string {
  const node: OutlineNode | undefined = nodes.get(id);
  const text = node?.text?.trim();
  return text ? text : id;
}
