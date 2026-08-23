/**
 * Ontology resolver (r5 core) — pure, isomorphic, dependency-free.
 *
 * An ontology is an ordinary node tagged `#ontology` carrying `sys.f.onto.*`
 * props. It is a new node KIND, not a new node type: nothing in the model
 * changes, and a node that never joins an ontology carries zero ontology
 * props (r5 §2.3).
 *
 * Membership (core = union + veto):
 *
 *     members(O) =  ⋃ members(P)  for P ∈ O.extends      -- inheritance
 *                ∪  { n | ∃t ∈ O.include . n tagged t }  -- supertag sets
 *                ∪  O.member                             -- explicit pins
 *                ∪  ids(run(O.query))                    -- query-defined
 *                ⊕  closure(O.closure)                   -- structural pull
 *                ∖  O.exclude                            -- absolute veto
 *                ∖  { O } ∪ extends-ancestors(O)         -- definitions
 *
 * Precedence: union everything, then subtract. `exclude` is absolute and wins
 * over tag-, query-, extends-, and closure-derived membership — the one rule a
 * human has to remember, and the rule that makes "remove this from my
 * ontology" always work.
 *
 * This module has no Node/Bun API and no datascript import: the EDN runner is
 * injected, which is what lets CLI, MCP, and the browser UI share ONE
 * implementation (`@kb/ontology`) instead of forking it.
 *
 * Out of core by design (r5 §2.9): `intersect` / `subtract` set algebra,
 * inference, auto-classification, validation enforcement, tag inheritance.
 */
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";

/**
 * Structural minimum both `KbNode` and `WireNode` satisfy — the reason one
 * resolver serves backend and browser.
 */
export interface NodeLike {
  readonly id: NodeId;
  readonly text: string;
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
  readonly children: readonly NodeId[];
}

export type MemberReasonKind =
  | "member"
  | "tag"
  | "query"
  | "extends"
  | "closure";

export interface MemberReason {
  kind: MemberReasonKind;
  /** Tag id, parent ontology id, or the member that pulled a descendant in. */
  via?: NodeId;
}

export interface OntologyResolution {
  ontologyId: NodeId;
  members: Set<NodeId>;
  /** Why each member is a member — drives the Members list. */
  reasons: Map<NodeId, MemberReason[]>;
  /** Ids explicitly vetoed (rendered as "excluded", restorable). */
  excluded: Set<NodeId>;
  /** Non-fatal: extends cycle, bad EDN, unknown ref, depth cap, size cap. */
  warnings: string[];
}

export interface ResolveOptions {
  /**
   * Parameter-free EDN → rows. Injected: backend passes `foundation/query`,
   * the UI passes `ds/query`. Absent ⇒ `sys.f.onto.query` is skipped + warned.
   */
  runQuery?: (edn: string) => unknown[][];
  /** Recursion guard for `extends`. Default 32. */
  maxDepth?: number;
  /** Warn (not fail) above this many members. Default 5000. */
  warnAbove?: number;
}

export const DEFAULT_MAX_DEPTH = 32;
export const DEFAULT_WARN_ABOVE = 5000;

export const ONTOLOGY_CLOSURE_MODES = ["none", "descendants"] as const;
export type OntologyClosureMode = (typeof ONTOLOGY_CLOSURE_MODES)[number];

/** Ref-picker constraint for `sys.f.onto.extends`: only `#ontology` nodes. */
export const ONTOLOGY_TARGET_QUERY = `[:find ?id :where [?n :f/${SYSTEM_IDS.typeField} ?t] [?t :node/id "${SYSTEM_IDS.ontologyTag}"] [?n :node/id ?id]]`;

/** All ontology nodes: id + text. Plain datalog, no new mechanism. */
export const LIST_ONTOLOGIES_QUERY = `[:find ?id ?text
               :where [?n :node/id ?id]
                      [?n :node/text ?text]
                      [?n :f/${SYSTEM_IDS.typeField} ?t]
                      [?t :node/id "${SYSTEM_IDS.ontologyTag}"]]`;

// ── prop readers ───────────────────────────────────────────────────────────

/** Ref values of a multi-valued ref field, in stored order. */
export function ontologyRefs(node: NodeLike, fieldId: string): NodeId[] {
  return (node.props[fieldId] ?? [])
    .filter((v) => v.t === "ref" && typeof v.v === "string")
    .map((v) => String(v.v));
}

/** First non-empty str value of a single-valued str field. */
export function ontologyStr(node: NodeLike, fieldId: string): string | null {
  for (const v of node.props[fieldId] ?? []) {
    if (v.t !== "str" || typeof v.v !== "string") continue;
    const trimmed = v.v.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Type refs (`sys.f.type`) of any node. */
function typeRefs(node: NodeLike): NodeId[] {
  return ontologyRefs(node, SYSTEM_IDS.typeField);
}

export function isOntologyNode(node: NodeLike): boolean {
  return typeRefs(node).includes(SYSTEM_IDS.ontologyTag);
}

/** `#ontology` nodes sorted by label then id (stable picker/sidebar order). */
export function listOntologyNodes<T extends NodeLike>(nodes: readonly T[]): T[] {
  return nodes
    .filter(isOntologyNode)
    .slice()
    .sort(
      (a, b) =>
        (a.text || a.id).localeCompare(b.text || b.id) ||
        a.id.localeCompare(b.id),
    );
}

export function ontologyClosureMode(node: NodeLike): OntologyClosureMode {
  const raw = ontologyStr(node, SYSTEM_IDS.ontoClosureField);
  return raw === "descendants" ? "descendants" : "none";
}

/**
 * Would adding `parentId` to `ontoId`'s `extends` close a cycle?
 * Cheap client-side pre-check; the resolver stays cycle-safe regardless.
 */
export function wouldCreateExtendsCycle(
  nodes: readonly NodeLike[],
  ontoId: NodeId,
  parentId: NodeId,
): boolean {
  if (ontoId === parentId) return true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<NodeId>();
  const stack: NodeId[] = [parentId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === ontoId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = byId.get(current);
    if (!node) continue;
    for (const next of ontologyRefs(node, SYSTEM_IDS.ontoExtendsField)) {
      stack.push(next);
    }
  }
  return false;
}

// ── resolution ─────────────────────────────────────────────────────────────

interface ResolveState {
  byId: Map<NodeId, NodeLike>;
  /** tag id → instance ids, built once per call. */
  byTag: Map<NodeId, NodeId[]>;
  warnings: string[];
  /** Deduped warning keys — a diamond must not warn twice. */
  warned: Set<string>;
  maxDepth: number;
  runQuery: ((edn: string) => unknown[][]) | undefined;
  /** Per-call memo; a cycle's partial result is intentionally reused. */
  cache: Map<NodeId, PartialResolution>;
  /** Ontologies on the current DFS path — back-edge detection. */
  visiting: Set<NodeId>;
  /** Ontology ids reached as `extends` ancestors (never members). */
  ancestors: Set<NodeId>;
}

interface PartialResolution {
  members: Set<NodeId>;
  reasons: Map<NodeId, MemberReason[]>;
  excluded: Set<NodeId>;
}

function warn(state: ResolveState, key: string, message: string): void {
  if (state.warned.has(key)) return;
  state.warned.add(key);
  state.warnings.push(message);
}

function buildTagIndex(nodes: readonly NodeLike[]): Map<NodeId, NodeId[]> {
  const byTag = new Map<NodeId, NodeId[]>();
  for (const node of nodes) {
    for (const tagId of typeRefs(node)) {
      const list = byTag.get(tagId);
      if (list) list.push(node.id);
      else byTag.set(tagId, [node.id]);
    }
  }
  return byTag;
}

function addMember(
  target: PartialResolution,
  id: NodeId,
  reason: MemberReason,
): void {
  target.members.add(id);
  const existing = target.reasons.get(id);
  if (!existing) {
    target.reasons.set(id, [reason]);
    return;
  }
  const dup = existing.some(
    (r) => r.kind === reason.kind && r.via === reason.via,
  );
  if (!dup) existing.push(reason);
}

/** Ids named by a datalog row set — first known-node string per row. */
function idsFromRows(rows: unknown[][], known: Set<NodeId>): NodeId[] {
  const out: NodeId[] = [];
  const seen = new Set<NodeId>();
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : [row];
    for (const cell of cells) {
      if (typeof cell !== "string" || !known.has(cell)) continue;
      if (!seen.has(cell)) {
        seen.add(cell);
        out.push(cell);
      }
      break;
    }
  }
  return out;
}

function resolveInto(
  state: ResolveState,
  ontologyId: NodeId,
  depth: number,
): PartialResolution {
  const cached = state.cache.get(ontologyId);
  if (cached) return cached;

  const result: PartialResolution = {
    members: new Set<NodeId>(),
    reasons: new Map<NodeId, MemberReason[]>(),
    excluded: new Set<NodeId>(),
  };
  const onto = state.byId.get(ontologyId);
  if (!onto) {
    warn(
      state,
      `missing:${ontologyId}`,
      `unknown ontology reference: ${ontologyId}`,
    );
    return result;
  }

  state.visiting.add(ontologyId);

  // 1. extends — parent members are inherited (A extends B ⇒ A ⊇ B).
  for (const parentId of ontologyRefs(onto, SYSTEM_IDS.ontoExtendsField)) {
    if (state.visiting.has(parentId)) {
      warn(
        state,
        `cycle:${ontologyId}->${parentId}`,
        `extends cycle ignored: ${ontologyId} → ${parentId} → ${ontologyId}`,
      );
      continue;
    }
    if (depth + 1 > state.maxDepth) {
      warn(
        state,
        `depth:${ontologyId}`,
        `extends depth cap (${state.maxDepth}) reached at ${ontologyId}; deeper parents skipped`,
      );
      continue;
    }
    const parent = state.byId.get(parentId);
    if (parent && !isOntologyNode(parent)) {
      warn(
        state,
        `notonto:${parentId}`,
        `extends target is not an #ontology node: ${parentId}`,
      );
      continue;
    }
    state.ancestors.add(parentId);
    const inherited = resolveInto(state, parentId, depth + 1);
    for (const id of inherited.members) {
      addMember(result, id, { kind: "extends", via: parentId });
    }
  }

  // 2. include tags — every instance of each listed tag.
  for (const tagId of ontologyRefs(onto, SYSTEM_IDS.ontoIncludeField)) {
    if (!state.byId.has(tagId)) {
      warn(
        state,
        `unknowntag:${ontologyId}:${tagId}`,
        `include tag not found: ${tagId}`,
      );
      continue;
    }
    // A tag with zero instances is a legitimate state, not a warning.
    for (const id of state.byTag.get(tagId) ?? []) {
      addMember(result, id, { kind: "tag", via: tagId });
    }
  }

  // 3. explicit members ("pins") — survive the tag being removed.
  for (const id of ontologyRefs(onto, SYSTEM_IDS.ontoMemberField)) {
    if (!state.byId.has(id)) {
      warn(
        state,
        `unknownmember:${ontologyId}:${id}`,
        `explicit member not found: ${id}`,
      );
      continue;
    }
    addMember(result, id, { kind: "member" });
  }

  // 4. query — parameter-free EDN; never throws across this boundary.
  const edn = ontologyStr(onto, SYSTEM_IDS.ontoQueryField);
  if (edn) {
    if (!state.runQuery) {
      warn(
        state,
        `norunner:${ontologyId}`,
        `onto.query skipped (no query runner supplied): ${ontologyId}`,
      );
    } else {
      try {
        const rows = state.runQuery(edn);
        const known = new Set(state.byId.keys());
        for (const id of idsFromRows(rows, known)) {
          addMember(result, id, { kind: "query" });
        }
      } catch (err) {
        warn(
          state,
          `badquery:${ontologyId}`,
          `onto.query failed on ${ontologyId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  // 5. closure — "descendants" pulls whole subtrees of existing members.
  if (ontologyClosureMode(onto) === "descendants") {
    const seeds = [...result.members];
    for (const seed of seeds) {
      const visited = new Set<NodeId>([seed]);
      const stack = [seed];
      while (stack.length > 0) {
        const current = stack.pop()!;
        const node = state.byId.get(current);
        if (!node) continue;
        for (const childId of node.children) {
          if (visited.has(childId)) continue;
          visited.add(childId);
          if (!state.byId.has(childId)) continue;
          addMember(result, childId, { kind: "closure", via: seed });
          stack.push(childId);
        }
      }
    }
  }

  // 6. exclude — absolute veto, applied last, wins over everything above.
  for (const id of ontologyRefs(onto, SYSTEM_IDS.ontoExcludeField)) {
    result.excluded.add(id);
    result.members.delete(id);
    result.reasons.delete(id);
  }

  // 7. the ontology is never its own member.
  result.members.delete(ontologyId);
  result.reasons.delete(ontologyId);

  state.visiting.delete(ontologyId);
  state.cache.set(ontologyId, result);
  return result;
}

/**
 * Resolve an ontology's membership. Deterministic: iteration follows the input
 * node order and the prop order on the ontology node, so two runs over the
 * same JSONL produce identical output.
 *
 * Never throws for graph-shaped problems — cycles, malformed EDN, unknown refs
 * and cap hits all surface as {@link OntologyResolution.warnings}, because a
 * broken definition must never make the UI unopenable.
 */
export function resolveOntology(
  nodes: readonly NodeLike[],
  ontologyId: NodeId,
  opts: ResolveOptions = {},
): OntologyResolution {
  const state: ResolveState = {
    byId: new Map(nodes.map((n) => [n.id, n])),
    byTag: buildTagIndex(nodes),
    warnings: [],
    warned: new Set<string>(),
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    runQuery: opts.runQuery,
    cache: new Map<NodeId, PartialResolution>(),
    visiting: new Set<NodeId>(),
    ancestors: new Set<NodeId>(),
  };

  const resolved = resolveInto(state, ontologyId, 0);

  // Parent ontologies are definitions, not content.
  for (const ancestorId of state.ancestors) {
    resolved.members.delete(ancestorId);
    resolved.reasons.delete(ancestorId);
  }

  const warnAbove = opts.warnAbove ?? DEFAULT_WARN_ABOVE;
  if (resolved.members.size > warnAbove) {
    state.warnings.push(
      `ontology ${ontologyId} resolved ${resolved.members.size} members (above ${warnAbove}); prefer tags/queries over explicit pins`,
    );
  }

  return {
    ontologyId,
    members: resolved.members,
    reasons: resolved.reasons,
    excluded: resolved.excluded,
    warnings: state.warnings,
  };
}

/** Human label for a provenance reason (shared by CLI receipts and the UI). */
export function describeReason(
  reason: MemberReason,
  labelOf: (id: NodeId) => string,
): string {
  switch (reason.kind) {
    case "member":
      return "pinned";
    case "tag":
      return reason.via ? `via #${labelOf(reason.via)}` : "via tag";
    case "extends":
      return reason.via ? `via ⬡ ${labelOf(reason.via)}` : "inherited";
    case "query":
      return "via query";
    case "closure":
      return reason.via ? `under ${labelOf(reason.via)}` : "descendant";
    default:
      return reason.kind;
  }
}
