import { queryBacklinks, type KbIndex } from "@/ds";
import { rowText } from "@/lib/contextual-ref";
import type { NodeMap, TagBadge } from "@/lib/types";

export interface BacklinkRow {
  id: string;
  text: string;
  tags: TagBadge[];
}

/**
 * Nodes that reference `nodeId`, resolved to rows ready to render.
 *
 * The query itself belongs to `ds/` — one owner for "what references X" — and
 * this is the layer above it that the References section consumes, so the seam
 * keeps one set of callers instead of gaining a component.
 *
 * Text comes from the referring node when it is in the projection, under the
 * same display rule as an outline row: a referrer whose own text is empty is a
 * contextual reference, and would otherwise render as a blank line.
 */
export function backlinkRows(index: KbIndex | null, nodes: NodeMap, nodeId: string): BacklinkRow[] {
  if (index === null) return [];
  return queryBacklinks(index, nodeId)
    .filter((b) => b.id !== nodeId)
    .map((b) => {
      const node = nodes.get(b.id);
      return {
        id: b.id,
        text: node ? rowText(node, nodes) : b.text,
        tags: node?.tags ?? [],
      };
    });
}
