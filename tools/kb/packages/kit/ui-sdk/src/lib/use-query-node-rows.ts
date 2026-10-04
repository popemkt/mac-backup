import { useEffect, useId, useMemo, useState } from "react";
import { runQuery, type KbIndex } from "../query";

/** Where a query node's subscribed rows go. */
interface QueryRowsSink {
  readonly rows: (rows: unknown[][]) => void;
  readonly error: (error: { readonly message: string }) => void;
}

/**
 * Subscribe a query node's rows as one subscriber (`querySubscriptionId`);
 * returns the unsubscribe. The page binds it to its live socket.
 */
export type QueryRowsSubscribe = (
  nodeId: string,
  subscriber: string,
  edn: string,
  sink: QueryRowsSink,
) => () => void;

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
 * is transport lifecycle, and running datalog belongs above the query seam (`query.ts`) —
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
  /** How to subscribe while live. */
  subscribe: QueryRowsSubscribe;
  index: KbIndex | null;
  generation: number;
}): QueryNodeRows {
  const { nodeId, edn, index, generation, subscribe } = input;
  const liveEdn = input.live ? edn : null;
  // Each caller holds its own subscription (`querySubscriptionId`).
  const subscriber = useId();

  const [liveRows, setLiveRows] = useState<unknown[][] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (liveEdn === null) return undefined;
    const unsubscribe = subscribe(nodeId, subscriber, liveEdn, {
      rows: (rows) => {
        setLiveRows(rows);
        setLiveError(null);
      },
      error: ({ message }) => {
        setLiveRows(null);
        setLiveError(message);
      },
    });
    return () => {
      unsubscribe();
      setLiveRows(null);
      setLiveError(null);
    };
  }, [liveEdn, nodeId, subscriber, subscribe]);

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
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation is the index revision; the index object's identity is stable
  }, [liveEdn, edn, index, generation]);

  return liveEdn === null ? local : { rows: liveRows, error: liveError };
}
