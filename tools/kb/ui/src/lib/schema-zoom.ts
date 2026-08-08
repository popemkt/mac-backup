/**
 * Schema-page live queries for zoomed tag / field nodes (DESIGN-REFINE §2 W3).
 */
import { runQuery } from "@/ds/query";
import type { QueryDb } from "@/ds/db";
import { SYSTEM_IDS } from "@/lib/types";
import type { OutlineNode } from "@/lib/types";

export type SchemaZoomKind = "tag" | "field" | null;

export function schemaZoomKind(
  node: OutlineNode | undefined,
): SchemaZoomKind {
  if (!node) return null;
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  if (types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.tag)) return "tag";
  if (types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.field))
    return "field";
  return null;
}

export interface SchemaHit {
  id: string;
  text: string;
}

/** Everything tagged with this tag node (Tana schema page). */
export function queryTaggedInstances(
  qdb: QueryDb,
  tagId: string,
): SchemaHit[] {
  const rows = runQuery(
    qdb,
    `[:find ?id ?text
      :where [?n :f/${SYSTEM_IDS.typeField} ?t]
             [?t :node/id "${tagId}"]
             [?n :node/id ?id]
             [?n :node/text ?text]]`,
  );
  return rowsToHits(rows).filter((h) => h.id !== tagId);
}

/** Nodes that carry this field as a prop key. */
export function queryFieldCarriers(
  qdb: QueryDb,
  fieldId: string,
): SchemaHit[] {
  const rows = runQuery(
    qdb,
    `[:find ?id ?text
      :where [?n :f/${fieldId} _]
             [?n :node/id ?id]
             [?n :node/text ?text]]`,
  );
  return rowsToHits(rows).filter((h) => h.id !== fieldId);
}

function rowsToHits(rows: unknown[][]): SchemaHit[] {
  const hits: SchemaHit[] = [];
  for (const row of rows) {
    const id = row[0];
    const text = row[1];
    if (typeof id !== "string") continue;
    hits.push({
      id,
      text: typeof text === "string" ? text : id,
    });
  }
  hits.sort((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
  return hits;
}
