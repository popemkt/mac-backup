import type { SchemaIndex } from "@/lib/schema";
import { queryBacklinks, type KbIndex } from "@/ds";
import { rowText } from "@/lib/contextual-ref";
import type { TagBadge } from "@/lib/types";

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
 * Text comes from the referring node, read from the schema so a referrer
 * outside the current scope is still named, under the same display rule as an
 * outline row: a referrer whose own text is empty is a contextual reference,
 * and would otherwise render as a blank line.
 */
export function backlinkRows(
  index: KbIndex | null,
  schema: SchemaIndex,
  nodeId: string,
): BacklinkRow[] {
  if (index === null) return [];
  return queryBacklinks(index, nodeId)
    .filter((b) => b.id !== nodeId)
    .map((b) => {
      // The referrer's own text is schema-level too: a referrer outside the
      // scope is still a node, and a contextual one shows its target's text.
      const node = schema.get(b.id);
      return {
        id: b.id,
        text: node ? rowText(node, schema) : b.text,
        tags: node?.tags ?? [],
      };
    });
}
