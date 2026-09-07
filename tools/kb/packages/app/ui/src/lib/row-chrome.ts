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
import { isContextualRef } from "@/lib/contextual-ref";
import { resolveProps } from "@/lib/graph-view";
import { isQueryNode } from "@/lib/query-node";
import type { NodeMap, OutlineNode } from "@/lib/types";
import { isProjectedViewMode, type ViewConfig } from "@/lib/view-config";

export interface RowChrome {
  /**
   * A contextual reference row IS a reference, so it takes the dashed ref ring
   * the outline already uses for reference rows. It is only the *bullet* that
   * is shared: the `isRef` prop means "this row renders a node whose home is
   * elsewhere", which suppresses nested results and the create-child strip. A
   * contextual reference's children are its own, so those gates keep reading
   * the prop, not this.
   */
  bulletIsRef: boolean;
  hasFields: boolean;
  showsQueryResults: boolean;
  showsChildren: boolean;
  /** Children or query results — the rows a frame's chrome belongs to. */
  hasFrameRows: boolean;
  /** What the bullet's toggle affordance promises. */
  isExpandable: boolean;
  /** Tana model: list = no chrome; toolbar only when mode ≠ list AND expanded. */
  showToolbar: boolean;
  /** The mode renders a flat projection, so rows are the projection's business. */
  projected: boolean;
  /** Whether this row offers the whitespace-create strip under its children. */
  showsCreateChild: boolean;
  /** The guide-line strip and everything under the row. */
  showsChildContainer: boolean;
}

export interface RowChromeInput {
  node: OutlineNode;
  nodes: NodeMap;
  viewConfig: ViewConfig;
  /** This render instance stands for a node whose home is elsewhere. */
  isRef: boolean;
  showDebugFields: boolean;
}

export function resolveRowChrome({
  node,
  nodes,
  viewConfig,
  isRef,
  showDebugFields,
}: RowChromeInput): RowChrome {
  const hasChildren = node.children.length > 0;
  const isQuery = isQueryNode(node);
  // A query node projects results instead of children, and a reference row
  // does not re-run a nested query.
  const showsQueryResults = isQuery && !isRef;
  const showsChildren = !isQuery && hasChildren;
  const hasFrameRows = showsChildren || showsQueryResults;
  const hasFields = resolveProps(node, nodes, { showDebugFields }).length > 0;
  const isExpandable = hasFrameRows || hasFields;
  const projected = isProjectedViewMode(viewConfig.mode);

  return {
    bulletIsRef: isRef || isContextualRef(node),
    hasFields,
    showsQueryResults,
    showsChildren,
    hasFrameRows,
    isExpandable,
    showToolbar: hasFrameRows && !node.collapsed && viewConfig.mode !== "list",
    projected,
    showsCreateChild: !isRef && !projected,
    showsChildContainer: isExpandable && !node.collapsed,
  };
}
