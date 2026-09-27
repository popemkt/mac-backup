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
 * The nodes of `nodes` a node picker may offer, as picker candidates, in
 * label order — the candidate source the field picker, the `[[`
 * autocomplete and the palette's "reference a node" step share. Matching and
 * ranking against a query are the engine's (`pickerRows`, lib/picker).
 *
 * The declared constraint is an *input*, applied before the engine ranks and
 * limits. Post-filtering an already-limited list was the other half of the
 * bug `isOfferable` describes: an allowed node that ranked 13th disappeared.
 */
export function nodeCandidates(
  nodes: ReadonlyMap<string, OutlineNode>,
  options: { allowed?: Set<string> | null; exclude?: (id: string) => boolean } = {},
): PickerCandidate[] {
  const { allowed = null, exclude } = options;
  const out: PickerCandidate[] = [];
  for (const n of nodes.values()) {
    if (!isOfferable(n.id, allowed)) continue;
    if (exclude?.(n.id) === true) continue;
    out.push({ id: n.id, label: n.text || n.id });
  }
  return out.toSorted((a, b) => a.label.localeCompare(b.label));
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
