import type { NodeMap } from "./types";
import { WORKSPACE_ROOT_ID } from "./types";
import { MAIN_PANE } from "./pane";

/**
 * The outline host the main pane's outline keys its rows under: the
 * canonical outline instance (`tree/<path>`).
 */
export const MAIN_OUTLINE_HOST = "tree";

/**
 * The outline host of a pane: every outline drawn in it keys its rows under
 * this, so the same node open in two panes is two rows, edited one at a time.
 * The main pane's is the canonical {@link MAIN_OUTLINE_HOST}.
 */
export function outlineHostOfPane(pane: string): string {
  return pane === MAIN_PANE ? MAIN_OUTLINE_HOST : `pane:${pane}`;
}

/** The host an instance key is keyed under: everything before its first separator. */
export function hostOfInstance(instanceKey: string): string {
  const cut = instanceKey.indexOf("/");
  return cut < 0 ? instanceKey : instanceKey.slice(0, cut);
}

/** Nest a child render under a parent instance key. */
export function childInstanceKey(parentKey: string, nodeId: string): string {
  return `${parentKey}/${nodeId}`;
}

/**
 * A node's instance in the outline host `host` (parent path + node id): the
 * key its row takes where that outline draws it from the tree. Used when
 * mutations or the keyboard activate a row without naming its instance.
 */
export function outlineInstanceKey(
  nodeId: string,
  nodes: NodeMap,
  host: string = MAIN_OUTLINE_HOST,
): string {
  const chain: string[] = [];
  let cur: string | null = nodeId;
  const seen = new Set<string>();
  while (cur !== null && cur !== WORKSPACE_ROOT_ID) {
    if (seen.has(cur)) break;
    seen.add(cur);
    chain.unshift(cur);
    cur = nodes.get(cur)?.parentId ?? null;
  }
  return `${host}/${chain.join("/")}`;
}

/**
 * Every instance drawn somewhere other than an outline's walk of the tree
 * carries this prefix — a query's projected rows, a node shown on a canvas —
 * and so does everything nested under one (`childInstanceKey` appends to it).
 */
const PROJECTION_PREFIX = "ref:";
const QUERY_RESULT_PREFIX = `${PROJECTION_PREFIX}query:`;
const CANVAS_PREFIX = `${PROJECTION_PREFIX}canvas:`;

/**
 * A node shown by canvas card `cardId`, as the projection `projection` (2D
 * or 3D) draws it: a projected instance, so the outline's walk of the tree
 * does not decide whether it is on screen — the card mounting its text does.
 * Each projection's is its own, so the one showing edits it alone.
 */
export function canvasInstanceKey(projection: string, cardId: string, nodeId: string): string {
  return `${CANVAS_PREFIX}${projection}:${cardId}/${nodeId}`;
}

/**
 * Query-result / reference-container instance. It names its query, not its
 * outline host, so one query open in two panes draws rows under the same keys,
 * and the keyboard walks them in the main pane's outline. GAP [[01M411FPC839XBJJ873V1VYYYD]]
 */
export function queryResultInstanceKey(queryNodeId: string, nodeId: string): string {
  return `${QUERY_RESULT_PREFIX}${queryNodeId}/${nodeId}`;
}

/**
 * The instance is projected: drawn somewhere other than an outline's walk of
 * the tree — inside a query's projected rows (a result row or one of its
 * descendants), or on a canvas. Its visibility is decided by the component
 * that mounts it, not by the outline walk.
 */
export function isProjectedInstance(instanceKey: string): boolean {
  return instanceKey.startsWith(PROJECTION_PREFIX);
}

/**
 * The instance IS a query result: its place under the query is computed, not
 * a child edge, so there is no structural edge for Tab, Enter or a move to
 * operate on. Its descendants are ordinary child edges of the result and are
 * not results themselves.
 *
 * Read from the key because the key is the row's identity: whatever renders
 * the row, the answer cannot disagree with where the row actually is.
 */
export function isQueryResultInstance(instanceKey: string): boolean {
  if (!instanceKey.startsWith(QUERY_RESULT_PREFIX)) return false;
  // `ref:query:<queryId>/<resultId>` — one separator; a descendant adds more.
  return instanceKey.slice(QUERY_RESULT_PREFIX.length).split("/").length === 2;
}

/**
 * The node ids of the rows an instance is drawn under, outermost first — the
 * query node for a projected row, then every row on the path down to (not
 * including) the instance itself.
 */
export function instanceAncestorIds(instanceKey: string): string[] {
  const path = instanceKey.startsWith(QUERY_RESULT_PREFIX)
    ? instanceKey.slice(QUERY_RESULT_PREFIX.length)
    : instanceKey.slice(instanceKey.indexOf("/") + 1);
  return path.split("/").slice(0, -1);
}
