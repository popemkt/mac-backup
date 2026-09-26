/**
 * A tag's field template resolved from the schema (`lib/schema.ts`): the
 * fields the tag already templates, and the existing fields it could add —
 * every field in the graph, not only those an ontology scope shows. Split out so it
 * can be exercised without a store or a live component, and so the config
 * component's module exports components only.
 */
import { typeRefsOf } from "@kb/model";
import type { SchemaIndex } from "@/lib/schema";
import { SYSTEM_IDS } from "@/lib/types";

export interface TagFieldRef {
  id: string;
  name: string;
}

export function resolveTagFields(
  schema: SchemaIndex,
  tagId: string,
): { template: TagFieldRef[]; suggestions: TagFieldRef[]; all: TagFieldRef[] } {
  const tag = schema.get(tagId);
  const templateIds = (tag?.props[SYSTEM_IDS.fieldsField] ?? [])
    .filter((v) => v.t === "ref")
    .map((v) => v.v);

  const all: TagFieldRef[] = [];
  for (const [id, node] of schema) {
    if (typeRefsOf(node).includes(SYSTEM_IDS.field)) {
      all.push({ id, name: node.text });
    }
  }
  all.sort((a, b) => a.name.localeCompare(b.name));

  const byId = new Map(all.map((f) => [f.id, f]));
  return {
    // Keep the tag's own order, and still show a ref whose field node is gone.
    template: templateIds.map((id) => byId.get(id) ?? { id, name: id }),
    suggestions: all.filter((f) => !templateIds.includes(f.id)),
    all,
  };
}
