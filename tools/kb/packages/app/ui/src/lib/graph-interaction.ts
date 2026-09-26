import type { LensEdge } from "./graph-lens";
import { graphNodeAlpha } from "./graph-dim";

/** One meaning of search, filtering and the selected node's neighbourhood. */
export interface GraphEmphasis {
  selectedNodeId?: string | null;
  highlightIds?: Set<string>;
  filterIds?: Set<string>;
}

/**
 * The node in focus, in every renderer: the selection beats the hover. A
 * hovered node is in focus only while nothing is selected.
 */
export function graphFocus(
  selected: string | null | undefined,
  hovered: string | null | undefined,
): string | null {
  return selected ?? hovered ?? null;
}

/** Whether the hover card shows: only for a hover that is the focus. */
export function showsHoverCard(selected: string | null | undefined): boolean {
  return (selected ?? null) === null;
}

export function graphNeighborhood(
  id: string | null | undefined,
  edges: readonly LensEdge[],
): Set<string> | null {
  if (id === null || id === undefined || id.length === 0) return null;
  const ids = new Set([id]);
  for (const edge of edges) {
    if (edge.source === id) ids.add(edge.target);
    if (edge.target === id) ids.add(edge.source);
  }
  return ids;
}

export function graphEmphasisAlpha(
  id: string,
  state: GraphEmphasis,
  neighborhood: Set<string> | null,
): number {
  return graphNodeAlpha({
    includedByFilter: !state.filterIds || state.filterIds.has(id),
    includedBySearch: !state.highlightIds || state.highlightIds.has(id),
    includedByFocus: !neighborhood || neighborhood.has(id),
  });
}

export function isGraphShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      "input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='menu']",
    )
  );
}
