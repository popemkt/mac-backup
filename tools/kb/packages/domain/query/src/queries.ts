/**
 * Standard DataScript EDN queries shared by CLI / surface mappers.
 * Keep query syntax here so surface/map.ts stays a flag→action adapter.
 */
import type { IrQuery } from "./ir/ir.ts";

/** All field nodes: id + text, in engine-neutral form. */
export const LIST_FIELDS_IR = {
  kind: "query",
  find: [
    { kind: "var", name: "id", type: "node-ref" },
    { kind: "var", name: "text", type: "scalar" },
  ],
  where: [
    { kind: "pattern", entity: "n", attr: ":node/id", value: { t: "var", name: "id" } },
    { kind: "pattern", entity: "n", attr: ":node/text", value: { t: "var", name: "text" } },
    { kind: "pattern", entity: "n", attr: ":f/sys.f.type", value: { t: "var", name: "t" } },
    { kind: "pattern", entity: "t", attr: ":node/id", value: { t: "str", value: "sys.field" } },
  ],
} satisfies IrQuery;

/** All tag nodes: id + text, in engine-neutral form. */
export const LIST_TAGS_IR = {
  kind: "query",
  find: [
    { kind: "var", name: "id", type: "node-ref" },
    { kind: "var", name: "text", type: "scalar" },
  ],
  where: [
    { kind: "pattern", entity: "n", attr: ":node/id", value: { t: "var", name: "id" } },
    { kind: "pattern", entity: "n", attr: ":node/text", value: { t: "var", name: "text" } },
    { kind: "pattern", entity: "n", attr: ":f/sys.f.type", value: { t: "var", name: "t" } },
    { kind: "pattern", entity: "t", attr: ":node/id", value: { t: "str", value: "sys.tag" } },
  ],
} satisfies IrQuery;

/** All nodes with text, in engine-neutral form. */
export const LIST_ALL_NODES_IR = {
  kind: "query",
  find: [
    { kind: "var", name: "id", type: "node-ref" },
    { kind: "var", name: "text", type: "scalar" },
  ],
  where: [
    { kind: "pattern", entity: "n", attr: ":node/id", value: { t: "var", name: "id" } },
    { kind: "pattern", entity: "n", attr: ":node/text", value: { t: "var", name: "text" } },
  ],
} satisfies IrQuery;

/** Nodes that reference the `id` input, with id binding outside query text. */
export const BACKLINKS_IR = {
  kind: "query",
  find: [
    { kind: "var", name: "from", type: "node-ref" },
    { kind: "var", name: "text", type: "scalar" },
  ],
  in: ["id"],
  where: [
    { kind: "pattern", entity: "e", attr: ":node/mentions", value: { t: "var", name: "m" } },
    { kind: "pattern", entity: "e", attr: ":node/id", value: { t: "var", name: "from" } },
    { kind: "pattern", entity: "e", attr: ":node/text", value: { t: "var", name: "text" } },
    { kind: "pattern", entity: "m", attr: ":node/id", value: { t: "var", name: "id" } },
  ],
} satisfies IrQuery;

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

/**
 * Nodes that reference `id`, via `:node/mentions` — the carrier-independent
 * reference relation (a `[[id]]` token in text *or* a `{t:"ref"}` prop value;
 * see `query/datascript.ts`). Single owner: the browser reads this same string
 * through the `@kb/queries` alias rather than keeping its own copy.
 */
export function backlinksQuery(id: string): string {
  return `[:find ?from ?text
               :where [?e :node/mentions ?m]
                      [?e :node/id ?from]
                      [?e :node/text ?text]
                      [?m :node/id ${JSON.stringify(id)}]]`;
}

/** Which way a neighbourhood walks an edge: along it (`out`) or against it (`in`). */
export type NeighbourhoodDirection = "out" | "in";

/**
 * The nodes within `hops` steps of `root` along `edge`, walked one way: a
 * `reach` over any node-valued attribute (`:node/mentions`, `:node/child`,
 * `:f/<fieldId>`), bounded by the hop count. `root` itself is not a row.
 *
 * `reach` is directed, so an undirected neighbourhood is the union of the
 * two directions, which a caller runs as two queries: written as one it
 * needs `or`, which drops the query to `raw` (DESIGN.md → Query layer). Even
 * the union misses a path that changes direction (a→b←c).
 */
export function neighbourhoodQuery(
  root: string,
  hops: number,
  edge: string,
  direction: NeighbourhoodDirection,
): string {
  if (!Number.isInteger(hops) || hops < 1)
    throw new RangeError(`neighbourhoodQuery: hops must be a positive integer, got ${hops}`);
  const walk =
    direction === "out" ? `(reach ?r ${edge} ?n ${hops})` : `(reach ?n ${edge} ?r ${hops})`;
  return `[:find ?id :where [?r :node/id ${JSON.stringify(root)}] ${walk} [?n :node/id ?id]]`;
}
