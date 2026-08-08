/**
 * Live results under an expanded query node (DESIGN-REFINE §2 W4).
 * Expanded → subscribe over /ws (existing SubscriptionHub); collapse or
 * unmount → unsubscribe. Offline / fixtures fall back to the local
 * DataScript db, re-run per graph rev. Result rows are read-only refs to
 * the real nodes: dashed bullets, click = zoom, text edit routes to the
 * source node, structural edits (Tab/indent & co) disabled.
 */
import { useEffect, useMemo, useState } from "react";
import { getLiveClient } from "@/api/live";
import { runQuery } from "@/ds/query";
import { queryDefOf, resultNodeIds, subscribeQueryNode } from "@/lib/query-node";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { NodeBlock } from "./node-block";

interface QueryResultsSectionProps {
  nodeId: string;
  depth: number;
}

export function QueryResultsSection({
  nodeId,
  depth,
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
    const unsubscribe = subscribeQueryNode(
      getLiveClient(),
      nodeId,
      edn,
      (rows) => {
        setLiveRows(rows);
        setLiveError(null);
      },
    );
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
    // rev: local results must re-run on every graph change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, edn, queryDb, rev]);

  if (!def || edn === null) return null;

  const rows = live ? liveRows : local.rows;
  const error = live ? liveError : local.error;
  const ids = rows
    ? resultNodeIds(rows, nodes, { limit: def.limit, excludeId: nodeId })
    : [];

  return (
    <div className="query-results" data-query-results-for={nodeId}>
      {error ? (
        <p
          className="px-1 py-0.5 text-[12px] text-destructive"
          style={{ paddingLeft: `calc(${depth + 1} * var(--kb-indent))` }}
        >
          {error}
        </p>
      ) : rows === null ? (
        <p
          className="px-1 py-0.5 text-[12px] text-foreground/50"
          style={{ paddingLeft: `calc(${depth + 1} * var(--kb-indent))` }}
        >
          loading results…
        </p>
      ) : ids.length === 0 ? (
        <p
          className="px-1 py-0.5 text-[12px] text-foreground/50"
          style={{ paddingLeft: `calc(${depth + 1} * var(--kb-indent))` }}
        >
          No results
        </p>
      ) : (
        ids.map((id) => (
          <NodeBlock key={id} nodeId={id} depth={depth + 1} isRef />
        ))
      )}
    </div>
  );
}
