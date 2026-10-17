/**
 * The nodes the graph elides unless asked for them: the store's scaffolding
 * rather than its content. A `sys.*` node, a `#command`, and the tag and
 * field nodes that are the schema. The renderers' node set and every walk
 * over the projection read this one predicate, so what a picture leaves out
 * a trace never routes through.
 */
import { isSysPrefixed, SYSTEM_IDS } from "@kb/model";
import type { LensSource } from "./edges.ts";

const SCHEMA_TYPES: ReadonlySet<string> = new Set([
  SYSTEM_IDS.command,
  SYSTEM_IDS.field,
  SYSTEM_IDS.tag,
]);

export function isScaffolding(node: Pick<LensSource, "id" | "props">): boolean {
  if (isSysPrefixed(node.id)) return true;
  return (node.props[SYSTEM_IDS.typeField] ?? []).some(
    (v) => v.t === "ref" && SCHEMA_TYPES.has(v.v),
  );
}
