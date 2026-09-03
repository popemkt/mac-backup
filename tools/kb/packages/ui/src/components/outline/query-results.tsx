/**
 * Live results under an expanded query node (DESIGN-REFINE §2 W4).
 * List mode → NodeBlock refs. Table/board/cards → shared FrameChildrenView
 * with query-result instance keys (W7.1 / W8e).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getLiveClient } from "@/api/live";
import { runQuery } from "@/ds/query";
import { indentStyle } from "@/lib/indent";
import { queryResultInstanceKey } from "@/lib/instance-key";
import { queryDefOf, resultNodeIds, subscribeQueryNode } from "@/lib/query-node";
import type { ViewMode } from "@/lib/view-config";
import { isProjectedViewMode } from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { FrameChildrenView } from "./frame-children-view";

interface QueryResultItem {
  nodeId: string;
  instanceKey: string;
  depth: number;
  isRef: boolean;
}

interface QueryResultsSectionProps {
  nodeId: string;
  depth: number;
  viewMode?: ViewMode;
  frameInstanceKey?: string;
  /** How to render one result node. Inverted from QueryResultsSection so the
   * recursive node <-> query-results pair is not a static import cycle. */
  renderNode: (item: QueryResultItem) => ReactNode;
}

export function QueryResultsSection({
  nodeId,
  depth,
  viewMode = "list",
  frameInstanceKey,
  renderNode,
}: QueryResultsSectionProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);
  const wsStatus = useUiStore((s) => s.wsStatus);

  const def = queryDefOf(node);
  const edn = def?.edn ?? null;
  const live = wsStatus === "open" && edn !== null;

  const [liveRows, setLiveRows] = useState<unknown[][] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!live || edn === null) return;
    const unsubscribe = subscribeQueryNode(getLiveClient(), nodeId, edn, (rows) => {
      setLiveRows(rows);
      setLiveError(null);
    });
    return () => {
      unsubscribe();
      setLiveRows(null);
    };
  }, [live, edn, nodeId]);

  const local = useMemo((): {
    rows: unknown[][] | null;
    error: string | null;
  } => {
    if (live || edn === null || !queryDb) return { rows: null, error: null };
    try {
      return { rows: runQuery(queryDb, edn), error: null };
    } catch (err) {
      return {
        rows: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, edn, queryDb, rev]);

  if (!def || edn === null) return null;

  const rows = live ? liveRows : local.rows;
  const error = live ? liveError : local.error;
  const ids = rows ? resultNodeIds(rows, nodes, { limit: def.limit, excludeId: nodeId }) : [];

  const indent = indentStyle(depth + 1);

  if (error) {
    return (
      <div className="query-results" data-query-results-for={nodeId}>
        <p className="px-1 py-0.5 text-[12px] text-destructive" style={indent}>
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
        <p className="px-1 py-0.5 text-[12px] text-foreground/50" style={indent}>
          Loading results…
        </p>
      </div>
    );
  }

  if (isProjectedViewMode(viewMode)) {
    return (
      <div className="query-results" data-query-results-for={nodeId} style={indent}>
        {ids.length === 0 ? (
          <p className="px-1 py-0.5 text-[12px] text-foreground/50">No results yet</p>
        ) : (
          <FrameChildrenView
            frameId={nodeId}
            frameInstanceKey={frameInstanceKey}
            rowIds={ids}
            isQuerySource
          />
        )}
      </div>
    );
  }

  return (
    <div className="query-results" data-query-results-for={nodeId}>
      {ids.length === 0 ? (
        <p className="px-1 py-0.5 text-[12px] text-foreground/50" style={indent}>
          No results
        </p>
      ) : (
        ids.map((id) => {
          const key = queryResultInstanceKey(nodeId, id);
          return renderNode({
            nodeId: id,
            instanceKey: key,
            depth: depth + 1,
            isRef: true,
          });
        })
      )}
    </div>
  );
}
