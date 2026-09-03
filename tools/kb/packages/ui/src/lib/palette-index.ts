/**
 * Cmd+K palette index — built once per graph rev (DESIGN-REFINE §2 W3).
 * Fuzzy match runs over a prebuilt lowercase haystack; callers virtualize ≤20 rows.
 */
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@/lib/types";

export type PaletteEntryKind = "command" | "node";

export interface PaletteEntry {
  id: string;
  text: string;
  kind: PaletteEntryKind;
  /** Prebuilt lowercase match string (text + id). */
  haystack: string;
  textLower: string;
  idLower: string;
}

export interface PaletteIndex {
  rev: number;
  entries: PaletteEntry[];
}

function isCommandNode(node: WireNode): boolean {
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  return types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.command);
}

/** Build searchable entries for every node (fields, tags, sys, commands). */
export function buildPaletteIndex(nodes: WireNode[], rev: number): PaletteIndex {
  const entries: PaletteEntry[] = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const text = n.text || n.id;
    const kind: PaletteEntryKind = isCommandNode(n) ? "command" : "node";
    const textLower = text.toLowerCase();
    const idLower = n.id.toLowerCase();
    entries[i] = {
      id: n.id,
      text,
      kind,
      haystack: `${textLower}\0${idLower}`,
      textLower,
      idLower,
    };
  }
  // Commands first for empty-query browsing, then stable by text.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "command" ? -1 : 1;
    return a.text.localeCompare(b.text) || a.id.localeCompare(b.id);
  });
  return { rev, entries };
}

function fuzzySubsequence(hay: string, q: string): boolean {
  let i = 0;
  for (let h = 0; h < hay.length && i < q.length; h++) {
    if (hay[h] === q[i]) i += 1;
  }
  return i >= q.length;
}

export interface PaletteHit extends PaletteEntry {
  score: number;
}

function cmpHit(a: PaletteHit, b: PaletteHit): number {
  return a.score - b.score || a.text.localeCompare(b.text) || a.id.localeCompare(b.id);
}

/**
 * Fuzzy search over a prebuilt index. Default limit 20 (virtualized row budget).
 * Empty query returns leading entries (commands first).
 *
 * Two-pass: substring hits first (hot keystroke path); fuzzy subsequence
 * only fills remaining slots so 50k graphs stay under the 10ms bar.
 */
export function searchPalette(index: PaletteIndex, query: string, limit = 20): PaletteHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    const slice = index.entries.slice(0, limit);
    const out: PaletteHit[] = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      out[i] = { ...slice[i]!, score: 0 };
    }
    return out;
  }

  const hits: PaletteHit[] = [];
  const { entries } = index;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const idx = e.textLower.indexOf(q);
    let score: number;
    if (idx === 0) score = 0;
    else if (idx > 0) score = 1;
    else if (e.idLower.includes(q) || e.haystack.includes(q)) score = 2;
    else continue;

    if (e.kind === "command") score -= 0.1;
    hits.push({ ...e, score });
  }

  if (hits.length >= limit) {
    hits.sort(cmpHit);
    return hits.slice(0, limit);
  }

  // Fuzzy only when substring found nothing — keeps keystroke path O(n)
  // substring scans without a second 50k subsequence pass.
  if (hits.length > 0) {
    hits.sort(cmpHit);
    return hits.slice(0, limit);
  }

  for (let i = 0; i < entries.length && hits.length < limit; i++) {
    const e = entries[i]!;
    if (!fuzzySubsequence(e.haystack, q)) continue;
    hits.push({
      ...e,
      score: 3 + (e.kind === "command" ? -0.1 : 0),
    });
  }

  hits.sort(cmpHit);
  return hits.slice(0, limit);
}
