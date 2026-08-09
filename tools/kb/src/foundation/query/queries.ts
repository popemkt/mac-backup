/**
 * Standard DataScript EDN queries shared by CLI / surface mappers.
 * Keep query syntax here so surface/map.ts stays a flag→action adapter.
 */

/** All field nodes: id + text. */
export const LIST_FIELDS_QUERY = `[:find ?id ?text
               :where [?n :node/id ?id]
                      [?n :node/text ?text]
                      [?n :f/sys.f.type ?t]
                      [?t :node/id "sys.field"]]`;

/** All tag nodes: id + text. */
export const LIST_TAGS_QUERY = `[:find ?id ?text
               :where [?n :node/id ?id]
                      [?n :node/text ?text]
                      [?n :f/sys.f.type ?t]
                      [?t :node/id "sys.tag"]]`;

/** All nodes with text — CLI filters substring client-side. */
export const LIST_ALL_NODES_QUERY = `[:find ?id ?text
               :where [?n :node/id ?id]
                      [?n :node/text ?text]]`;

/** Nodes that mention `id` via :node/mentions. */
export function backlinksQuery(id: string): string {
  return `[:find ?from ?text
               :where [?e :node/mentions ?m]
                      [?e :node/id ?from]
                      [?e :node/text ?text]
                      [?m :node/id "${id}"]]`;
}
