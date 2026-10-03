import { declaresOptionSet, targetQueryOf, targetTagsOf } from "@kb/model";
import { allowedRefsOf } from "@/lib/field-type";
import type { FieldContext } from "@/lib/schema";
import type { PickerCandidate } from "@/lib/picker";
import type { OutlineNode } from "@/lib/types";
import { isSysPrefixed, WORKSPACE_ROOT_ID } from "@/lib/types";

/**
 * Which nodes a ref picker may offer.
 *
 * One rule, one place. `allowed` is the field node's own declaration
 * (`sys.f.targetTag` / `sys.f.targetQuery`, resolved by lib/field-type), and
 * when a field declares its targets those targets *are* the candidate set —
 * the "hide infrastructure nodes" heuristic below is not entitled to overrule
 * data. That heuristic exists only to keep the seeded ontology out of
 * open-ended search, so it applies only when nothing is declared.
 *
 * Getting this precedence backwards is what made `sys.f.fieldType` unfillable:
 * it declares `#field-type`, whose every member is `sys.ft.*`, so a blanket
 * sys skip left the picker with nothing to offer at all.
 */
function isOfferable(id: string, allowed: Set<string> | null): boolean {
  if (allowed) return allowed.has(id);
  return id !== WORKSPACE_ROOT_ID && !isSysPrefixed(id);
}

/** What a ref field's picker searches, and within which declared set. */
export interface RefSearch {
  /** The field's declared targets, or null when it declares none. */
  readonly allowed: Set<string> | null;
  /** The nodes candidates are drawn from. */
  readonly pool: ReadonlyMap<string, OutlineNode>;
}

/**
 * The one rule for where a ref field's picker looks. A field that declares
 * its targets has an option set, and an option set is schema: its members are
 * offered whatever the outline shows. A field that declares nothing is an open
 * search for a node to point at — navigation, like `[[` — so it searches the
 * outline as shown, and under an ontology scope offers members only
 * (DESIGN-UI.md → Scope is a projection).
 */
export function refSearchOf(context: FieldContext, fieldId: string): RefSearch {
  const allowed = allowedRefsOf(context, fieldId);
  return { allowed, pool: allowed === null ? context.outline : context.schema };
}

/**
 * Where a node minted from a ref field's picker goes, so that it is one of
 * the field's allowed values the moment it exists: a new option is a child of
 * the field (the children carrier), a new target of a tag-constrained field
 * carries the field's first target tag, and an open field's new target is a
 * top-level node. A field whose targets are a query offers no create: kb
 * cannot mint a node a query is guaranteed to return.
 */
export type RefCreation =
  | { readonly kind: "child"; readonly parentId: string }
  | { readonly kind: "tagged"; readonly tagId: string }
  | { readonly kind: "root" };

export function refCreationOf(context: FieldContext, fieldId: string): RefCreation | null {
  const field = context.schema.get(fieldId);
  if (declaresOptionSet(field)) return { kind: "child", parentId: fieldId };
  const query = targetQueryOf(field);
  if (query !== null && query !== "") return null;
  const [tagId] = targetTagsOf(field);
  if (tagId !== undefined) return { kind: "tagged", tagId };
  return { kind: "root" };
}

/**
 * How many nodes already hold each value of `fieldId` — what "most used"
 * means to a field's picker (`orderCandidates`).
 */
export function refUses(
  nodes: ReadonlyMap<string, OutlineNode>,
  fieldId: string,
): Map<string, number> {
  const uses = new Map<string, number>();
  for (const node of nodes.values()) {
    for (const value of node.props[fieldId] ?? []) {
      if (value.t === "ref") uses.set(value.v, (uses.get(value.v) ?? 0) + 1);
    }
  }
  return uses;
}

/**
 * Every node of a map as a picker candidate, in label order. Sorting is the
 * expensive half of a candidate list, and it depends on the map alone, so it
 * is derived once per map identity and shared by every picker that reads it.
 */
const labelOrdered = new WeakMap<ReadonlyMap<string, OutlineNode>, readonly PickerCandidate[]>();

function candidatesInLabelOrder(
  nodes: ReadonlyMap<string, OutlineNode>,
): readonly PickerCandidate[] {
  const cached = labelOrdered.get(nodes);
  if (cached !== undefined) return cached;
  const all = Array.from(nodes.values(), (n) => ({ id: n.id, label: n.text || n.id }));
  const sorted = all.toSorted((a, b) => a.label.localeCompare(b.label));
  labelOrdered.set(nodes, sorted);
  return sorted;
}

/**
 * The nodes of `nodes` a node picker may offer, as picker candidates, in
 * label order — the candidate source the field picker, the `[[`
 * autocomplete and the palette's "reference a node" step share. Matching and
 * ranking against a query are the engine's (`pickerRows`, lib/picker).
 *
 * The declared constraint is an *input*, applied before the engine ranks and
 * limits. Post-filtering an already-limited list was the other half of the
 * bug `isOfferable` describes: an allowed node that ranked 13th disappeared.
 * Filtering keeps the shared label order, which is stable, so it is the order
 * the offered set alone would sort to.
 */
export function nodeCandidates(
  nodes: ReadonlyMap<string, OutlineNode>,
  options: { allowed?: Set<string> | null; exclude?: (id: string) => boolean } = {},
): PickerCandidate[] {
  const { allowed = null, exclude } = options;
  return candidatesInLabelOrder(nodes).filter(
    (c) => isOfferable(c.id, allowed) && exclude?.(c.id) !== true,
  );
}

/** Build the wiki-link token inserted on autocomplete select. */
function formatRefToken(id: string, label: string): string {
  const clean = label.replace(/[[\]]/g, "").trim() || id;
  return `[[${id}|${clean}]]`;
}

/**
 * Replace an open `[[query` (or bare `[[`) at `cursor` with a completed ref.
 * Returns null if no open ref trigger is found.
 */
export function insertRefAtCursor(
  text: string,
  cursor: number,
  id: string,
  label: string,
): { text: string; cursor: number } | null {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const m = before.match(/\[\[([^\][]*?)$/);
  if (!m) return null;
  const start = before.length - m[0].length;
  const token = formatRefToken(id, label);
  const next = text.slice(0, start) + token + after;
  return { text: next, cursor: start + token.length };
}

/** Detect open `[[query` at cursor for autocomplete UI. */
export function openRefQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const m = before.match(/\[\[([^\][]*?)$/);
  if (!m) return null;
  return {
    start: before.length - m[0].length,
    query: m[1] ?? "",
  };
}
