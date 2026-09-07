import { useEffect, useMemo, useState } from "react";
import { getLiveClient } from "@/api/live";
import { runQuery, type KbIndex } from "@/ds";
import { subscribeQueryNode } from "@/lib/query-node";

export interface QueryNodeRows {
  rows: unknown[][] | null;
  error: string | null;
}

/**
 * The rows an expanded query node currently has, from whichever source can
 * answer: a /ws subscription while the socket is open, the local index
 * otherwise.
 *
 * Both halves live here rather than in the component that renders them. A
 * surface renders what it is given; opening and closing a server subscription
 * is transport lifecycle, and running datalog belongs above the `ds/` seam —
 * `lib/query-node.ts` stays pure system-node modeling, and this is the one
 * place that turns a query node's EDN into rows.
 *
 * `generation` is the index's mutation counter: the local query re-runs when
 * the replica advances, which `index` alone cannot express because it is the
 * same instance across a transaction.
 */
export function useQueryNodeRows(input: {
  nodeId: string;
  edn: string | null;
  /** Subscribe instead of querying locally — true while /ws is open. */
  live: boolean;
  index: KbIndex | null;
  generation: number;
}): QueryNodeRows {
  const { nodeId, edn, index, generation } = input;
  const liveEdn = input.live ? edn : null;

  const [liveRows, setLiveRows] = useState<unknown[][] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (liveEdn === null) return undefined;
    const unsubscribe = subscribeQueryNode(getLiveClient(), nodeId, liveEdn, (rows) => {
      setLiveRows(rows);
      setLiveError(null);
    });
    return () => {
      unsubscribe();
      setLiveRows(null);
    };
  }, [liveEdn, nodeId]);

  const local = useMemo((): QueryNodeRows => {
    if (liveEdn !== null || edn === null || !index) return { rows: null, error: null };
    try {
      return { rows: runQuery(index, edn), error: null };
    } catch (err) {
      return {
        rows: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEdn, edn, index, generation]);

  return liveEdn === null ? local : { rows: liveRows, error: liveError };
}
