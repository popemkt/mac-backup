/**
 * Ontology scope — "when you use an ontology, you only see nodes of such
 * ontology and how they're connected."
 *
 * Scope is a PROJECTION, not a sandbox. The outline is projected through one
 * function (`wireToOutlineMap`), so filtering the array handed to it scopes the
 * outline, search, keyboard nav, and breadcrumbs at once. `index` stays built
 * over the FULL wire set on purpose: backlinks, `#query` nodes, and WS
 * subscriptions keep global reach and honest results. Scoping the datalog
 * engine is deliberately out of core (r5 §2.9).
 */
import type { WireNode } from "@kb/contracts";
import {
  listOntologyNodes,
  resolveOntology,
  type MemberReason,
  type OntologyResolution,
} from "@kb/model";
import { runQuery, textOr, type KbIndex, type NodeMap, type OutlineNode } from "@kb/ui-sdk";

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
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/**
 * Memoized per snapshot IDENTITY, not per `rev`.
 *
 * `rev` is the server's counter and does NOT move for a local optimistic edit,
 * so keying on it alone would serve stale membership the moment you add an
 * include tag. Every store transition mints a fresh `wireNodes` array, which
 * makes the array itself the exact key; a WeakMap keeps it leak-free.
 */
const scopeCache = new WeakMap<readonly WireNode[], Map<string, OntologyResolution>>();

/**
 * Resolve membership for a scope.
 *
 * The client datalog runner takes no inputs, so `sys.f.onto.query` must be
 * parameter-free EDN — same contract as every other client-side query in kb.
 * `generation` joins the key so a same-array resync still re-resolves.
 */
export function resolveScope(
  wireNodes: WireNode[],
  ontologyId: string,
  queryDb: KbIndex | null,
  generation: number,
): OntologyResolution {
  const key = `${generation}\u0000${ontologyId}`;
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
/**
 * Rows take a label resolver rather than a NodeMap.
 *
 * An excluded node is, by definition, absent from a scoped node map — so
 * looking its label up there always failed and fell back to printing a raw
 * ulid. The page already owns a resolver that consults the unscoped nodes as
 * well; passing it in is what lets both lists use one answer.
 */
export function memberRows(
  resolution: OntologyResolution,
  resolveLabel: (id: string) => string,
): MemberRowModel[] {
  const rows: MemberRowModel[] = [];
  for (const id of resolution.members) {
    const reasons = resolution.reasons.get(id) ?? [];
    rows.push({
      id,
      label: resolveLabel(id),
      reasons,
      pinned: reasons.some((r) => r.kind === "member"),
    });
  }
  return rows.toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** Excluded rows for the ontology page ("restore" candidates). */
export function excludedRows(
  resolution: OntologyResolution,
  resolveLabel: (id: string) => string,
): MemberRowModel[] {
  return [...resolution.excluded]
    .map((id) => ({
      id,
      label: resolveLabel(id),
      reasons: [] as MemberReason[],
      pinned: false,
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function labelOf(id: string, nodes: NodeMap): string {
  const node: OutlineNode | undefined = nodes.get(id);
  return textOr(node?.text.trim(), id);
}
