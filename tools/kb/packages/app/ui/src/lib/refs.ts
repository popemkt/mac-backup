import type { NodeMap } from "@/lib/types";
import { isSysPrefixed, WORKSPACE_ROOT_ID } from "@/lib/types";

export interface RefCandidate {
  id: string;
  text: string;
  score: number;
}

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

/**
 * Fuzzy candidate resolution for every ref picker — the `[[ref]]` autocomplete
 * in node text and the typed ref field editor both come through here.
 *
 * The declared constraint is an *input*, applied before ranking and the limit.
 * Post-filtering the already-limited list was the other half of the same bug:
 * an allowed node that ranked 13th disappeared.
 */
export function fuzzyNodeCandidates(
  nodes: NodeMap,
  query: string,
  options: { allowed?: Set<string> | null; limit?: number } = {},
): RefCandidate[] {
  const { allowed = null, limit = 12 } = options;
  const q = query.trim().toLowerCase();
  const out: RefCandidate[] = [];
  for (const n of nodes.values()) {
    if (!isOfferable(n.id, allowed)) continue;
    const text = n.text || n.id;
    const hay = `${text} ${n.id}`.toLowerCase();
    if (!q) {
      out.push({ id: n.id, text, score: 0 });
      continue;
    }
    if (!hay.includes(q) && !fuzzySubsequence(hay, q)) continue;
    const idx = text.toLowerCase().indexOf(q);
    const score = idx === 0 ? 0 : idx > 0 ? 1 : n.id.toLowerCase().includes(q) ? 2 : 3;
    out.push({ id: n.id, text, score });
  }
  out.sort((a, b) => a.score - b.score || a.text.localeCompare(b.text));
  return out.slice(0, limit);
}

function fuzzySubsequence(hay: string, q: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) i += 1;
    if (i >= q.length) return true;
  }
  return false;
}

/** Build the wiki-link token inserted on autocomplete select. */
export function formatRefToken(id: string, label: string): string {
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
