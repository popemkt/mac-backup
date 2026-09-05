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
