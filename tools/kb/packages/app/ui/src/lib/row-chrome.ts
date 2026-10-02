/**
 * What a row shows, as one value.
 *
 * `NodeBlock` derived `hasFields`, `showsQueryResults`, `showsChildren`,
 * `hasFrameRows`, `isExpandable`, `showToolbar`, `projected` and `bulletIsRef`
 * in its own body and then branched on all eight inside its JSX, so a
 * view-mode change was a hunt through a component rather than one edit. The
 * rules live here; the component renders what it is handed.
 *
 * The flags are not independent, and the dependencies are the point:
 * "expandable" must not promise more than the render gates deliver, which is
 * why it is derived from them rather than asked separately.
 */
import type { SchemaIndex } from "@/lib/schema";
import { isContextualRef, shownNode, showsAncestor } from "@/lib/contextual-ref";
import { resolveProps } from "@/lib/graph-view";
import { isQueryResultInstance } from "@/lib/instance-key";
import { isQueryNode } from "@/lib/query-node";
import type { OutlineNode } from "@/lib/types";
import { projectsRows, type FrameViewKey } from "@kb/views";

export interface RowChrome {
  /**
   * A contextual reference row IS a reference, so it takes the dashed ref ring
   * the outline already uses for query-result rows. It is only the *bullet*
   * that is shared: a query-result row's place is computed rather than a child
   * edge, which suppresses nested results and the create-child strip. A
   * contextual reference is a real child with children of its own, so those
   * gates keep reading `isQueryResult`, not this.
   */
  bulletIsRef: boolean;
  hasFields: boolean;
  showsQueryResults: boolean;
  showsChildren: boolean;
  /** Children or query results — the rows a frame's chrome belongs to. */
  hasFrameRows: boolean;
  /** What the bullet's toggle affordance promises. */
  isExpandable: boolean;
  /** Tana model: list = no chrome; toolbar only when the view is not the list AND expanded. */
  showToolbar: boolean;
  /** The view renders a flat projection, so rows are the projection's business. */
  projected: boolean;
  /** Whether this row offers the whitespace-create strip under its children. */
  showsCreateChild: boolean;
  /** The guide-line strip and everything under the row. */
  showsChildContainer: boolean;
}

/**
 * The row stands for a node whose place or text lives elsewhere — a query
 * result, or a contextual reference — and so wears the dashed ref ring. One
 * answer for every surface that draws a row (list, table, card).
 */
export function isReferenceRow(node: OutlineNode, isQueryResult: boolean): boolean {
  return isQueryResult || isContextualRef(node);
}

export interface RowChromeInput {
  /** The row's node — for a contextual reference, the reference itself. */
  node: OutlineNode;
  /** Where field definitions are read from: the whole graph (`lib/schema.ts`). */
  schema: SchemaIndex;
  /** The view the children of the node the row shows are shown in. */
  view: FrameViewKey | null;
  /**
   * This render instance. Whether the row is a query result
   * (`isQueryResultInstance`) and whether it repeats a row above it
   * (`showsAncestor`) are read from it.
   */
  instanceKey: string;
  showDebugFields: boolean;
}

/**
 * What the row draws is its shown node's (`shownNode`): children, query,
 * fields. Whether it is open is the row's own (`node.collapsed`), and so is
 * the reference ring.
 */
export function resolveRowChrome({
  node,
  schema,
  view,
  instanceKey,
  showDebugFields,
}: RowChromeInput): RowChrome {
  const shown = shownNode(node, schema);
  const isQueryResult = isQueryResultInstance(instanceKey);
  // A row that repeats one above it draws no rows under it (`showsAncestor`).
  const repeats = showsAncestor(instanceKey, node, schema);
  const hasChildren = shown.children.length > 0 && !repeats;
  const isQuery = isQueryNode(shown);
  // A query node projects results instead of children, and a result row does
  // not re-run a nested query.
  const showsQueryResults = isQuery && !isQueryResult && !repeats;
  const showsChildren = !isQuery && hasChildren;
  const hasFrameRows = showsChildren || showsQueryResults;
  const hasFields = resolveProps(shown, schema, { showDebugFields }).length > 0;
  const isExpandable = hasFrameRows || hasFields;
  const projected = projectsRows(view);

  return {
    bulletIsRef: isReferenceRow(node, isQueryResult),
    hasFields,
    showsQueryResults,
    showsChildren,
    hasFrameRows,
    isExpandable,
    showToolbar: hasFrameRows && !node.collapsed && projected,
    projected,
    showsCreateChild: !isQueryResult && !projected,
    showsChildContainer: isExpandable && !node.collapsed,
  };
}
