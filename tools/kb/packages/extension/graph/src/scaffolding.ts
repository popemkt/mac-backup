/**
 * The nodes the graph elides unless asked for them: the store's scaffolding
 * rather than its content. A `sys.*` node, a `#command`, and the tag and
 * field nodes that are the schema. The renderers' node set and every read
 * over the projection take their nodes from `visibleNodes`, so what a
 * picture leaves out a trace never routes through, and no degree counts it.
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

/**
 * `nodes` as the graph shows them: without the scaffolding unless
 * `includeSystem`, and with the nodes a read names (`keeping`: a trace's
 * ends, a suggestion's subject) whatever they are.
 */
export function visibleNodes<N extends Pick<LensSource, "id" | "props">>(
  nodes: readonly N[],
  {
    includeSystem = false,
    keeping = [],
  }: { includeSystem?: boolean; keeping?: readonly string[] } = {},
): N[] {
  if (includeSystem) return [...nodes];
  const kept = new Set(keeping);
  return nodes.filter((node) => kept.has(node.id) || !isScaffolding(node));
}
