/**
 * The outline as a graph source (`@kb/ui-sdk` → `lib/graph-read`): what a
 * row's tracked read of the graph answers from — the outline's projection,
 * and the graph store's schema and index. The page's `BrowserHost` answers its
 * graph reads from this same source.
 */
import { schemaOf, useGraphReadThrough, type GraphRead, type GraphSource } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { useOutlineStore, outlineNodes } from "@/stores/outline.store";

export const outlineGraph: GraphSource = {
  subscribe: (listener) => {
    const fromGraph = useGraphStore.subscribe(listener);
    const fromOutline = useOutlineStore.subscribe(listener);
    return () => {
      fromGraph();
      fromOutline();
    };
  },
  nodes: () => outlineNodes(),
  schema: () => schemaOf(useGraphStore.getState()),
  index: () => useGraphStore.getState().index,
};

/** The graph, read by this component: it re-renders when what it read changes. */
export function useGraphRead(): GraphRead {
  return useGraphReadThrough(outlineGraph);
}
