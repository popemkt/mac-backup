/**
 * Trace mode (DESIGN-UI.md → Graph → Tracing): the paths between two drawn
 * nodes, lit in place while everything else dims. It is transient selection
 * state, like search and legend dimming; saving it writes a graph view node
 * whose lens names the trace (`lens.trace-from`, `lens.trace-to`,
 * `lens.trace-paths`). It belongs to the perspective it was begun in, so
 * opening another (the saved one included) leaves it behind. The paths are `tracePerspective` over the nodes
 * drawn, the one trace read a saved trace's node set takes too.
 */
import { useCallback, useMemo, useState } from "react";
import type { WireNode } from "@kb/contracts";
import type { LensPerspective, TraceAnswer } from "@kb/graph";
import { nodesWithin, tracePerspective, type GraphLens } from "./graph-lens";

/** A trace begun at `from`; `to` is null while the person picks where it goes. */
export interface GraphTrace {
  readonly from: string;
  readonly to: string | null;
}

/** What a renderer draws of a trace, and how it ends one: the lit nodes, and trace-to. */
export interface TraceFrame {
  /** The ends and the nodes on the paths between them; null when no trace is drawn. */
  readonly lit: Set<string> | null;
  /** Trace from the selection to `id` (a renderer's shift-click). */
  readonly to: (id: string) => void;
}

/** A host that draws no trace (a neighbourhood): nothing lit, and trace-to does nothing. */
export const NO_TRACE: TraceFrame = { lit: null, to: () => undefined };

export interface GraphTraceState {
  readonly trace: GraphTrace | null;
  readonly answer: TraceAnswer | null;
  readonly frame: TraceFrame;
  /** Begin a trace at `from`; the next node picked ends it. */
  readonly begin: (from: string) => void;
  /** End the trace begun, at `to`; a pick with no trace begun, or at its start, does nothing. */
  readonly pick: (to: string) => boolean;
  readonly clear: () => void;
}

export function useGraphTrace(
  perspective: LensPerspective | null,
  lensGraph: GraphLens,
  wireNodes: readonly WireNode[],
  selectedId: string | null,
): GraphTraceState {
  const [held, setHeld] = useState<{ readonly in: string; readonly trace: GraphTrace } | null>(
    null,
  );
  const here = perspective?.id ?? null;
  const trace = held !== null && held.in === here ? held.trace : null;
  const setTrace = useCallback(
    (next: GraphTrace | null) =>
      setHeld(next === null || here === null ? null : { in: here, trace: next }),
    [here],
  );
  const answer = useMemo(() => {
    if (trace === null || trace.to === null || perspective === null) return null;
    const drawn = new Set(lensGraph.nodes.map((node) => node.id));
    return tracePerspective(nodesWithin(wireNodes, drawn), perspective, trace.from, trace.to);
  }, [trace, perspective, lensGraph.nodes, wireNodes]);
  const begin = useCallback((from: string) => setTrace({ from, to: null }), [setTrace]);
  const pick = useCallback(
    (to: string) => {
      if (trace === null || trace.to !== null || trace.from === to) return false;
      setTrace({ from: trace.from, to });
      return true;
    },
    [trace, setTrace],
  );
  const clear = useCallback(() => setTrace(null), [setTrace]);
  const to = useCallback(
    (id: string) => {
      if (selectedId !== null && selectedId !== id) setTrace({ from: selectedId, to: id });
    },
    [selectedId, setTrace],
  );
  const lit = useMemo(
    () =>
      answer === null || trace === null
        ? null
        : new Set([
            trace.from,
            ...answer.paths.flatMap((path) => path.nodes),
            trace.to ?? trace.from,
          ]),
    [answer, trace],
  );
  const frame = useMemo(() => ({ lit, to }), [lit, to]);
  return { trace, answer, frame, begin, pick, clear };
}
