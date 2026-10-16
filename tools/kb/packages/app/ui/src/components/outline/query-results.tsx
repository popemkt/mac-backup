/**
 * Live results under an expanded query node (DESIGN-REFINE §2 W4).
 * The list view → NodeBlock refs, continuing the list. Any other view → the
 * frame's view in a slot, over the results, with query-result instance keys
 * (W7.1 / W8e).
 */
import type { ReactNode } from "react";
import {
  hasText,
  indentStyle,
  queryResultInstanceKey,
  resultNodeIds,
  useQueryRows,
} from "@kb/ui-sdk";
import { queryDefOf } from "@kb/model";
import { projectsRows, type FrameViewKey } from "@kb/views";
import { useOutlineNode, useOutlineNodes } from "@/components/outline/outline.store";
import { FrameViewSlot } from "./frame-view-slot";

interface QueryResultItem {
  nodeId: string;
  instanceKey: string;
  depth: number;
}

interface QueryResultsSectionProps {
  nodeId: string;
  depth: number;
  /** The view the query node shows its results in; null while none is provided. */
  view: FrameViewKey | null;
  frameInstanceKey?: string;
  /** How to render one result node. Inverted from QueryResultsSection so the
   * recursive node <-> query-results pair is not a static import cycle. */
  renderNode: (item: QueryResultItem) => ReactNode;
}

export function QueryResultsSection({
  nodeId,
  depth,
  view,
  frameInstanceKey,
  renderNode,
}: QueryResultsSectionProps) {
  const node = useOutlineNode(nodeId);
  const nodes = useOutlineNodes();
  const def = queryDefOf(node);
  const edn = def?.edn ?? null;

  const { rows, error } = useQueryRows({ nodeId, edn });

  if (!def || edn === null) return null;

  const ids = rows ? resultNodeIds(rows, nodes, { limit: def.limit, excludeId: nodeId }) : [];

  const indent = indentStyle(depth + 1);

  if (hasText(error)) {
    return (
      <div className="query-results" data-query-results-for={nodeId}>
        <p className="px-1 py-0.5 text-meta text-destructive" style={indent}>
          {error}
        </p>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div
        className="query-results"
        data-query-results-for={nodeId}
        aria-busy="true"
        aria-live="polite"
      >
        <p className="px-1 py-0.5 text-meta text-foreground/50" style={indent}>
          Loading results…
        </p>
      </div>
    );
  }

  if (projectsRows(view)) {
    return (
      <div className="query-results" data-query-results-for={nodeId} style={indent}>
        {ids.length === 0 ? (
          <p className="px-1 py-0.5 text-meta text-foreground/50">No results yet</p>
        ) : (
          <FrameViewSlot
            frameId={nodeId}
            instanceKey={frameInstanceKey}
            rowIds={ids}
            isQuerySource
            depth={depth + 1}
          />
        )}
      </div>
    );
  }

  return (
    <div className="query-results" data-query-results-for={nodeId}>
      {ids.length === 0 ? (
        <p className="px-1 py-0.5 text-meta text-foreground/50" style={indent}>
          No results
        </p>
      ) : (
        ids.map((id) => {
          const key = queryResultInstanceKey(nodeId, id);
          return renderNode({
            nodeId: id,
            instanceKey: key,
            depth: depth + 1,
          });
        })
      )}
    </div>
  );
}
