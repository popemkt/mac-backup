/**
 * The outline store as a graph source (`@kb/ui-sdk` → `lib/graph-read`): what
 * a row's tracked read of the graph answers from. The page's `BrowserHost`
 * answers its graph reads from this same source.
 */
import { schemaOf, useGraphReadThrough, type GraphRead, type GraphSource } from "@kb/ui-sdk";
import { useOutlineStore } from "@/stores/outline.store";

export const outlineGraph: GraphSource = {
  subscribe: useOutlineStore.subscribe,
  nodes: () => useOutlineStore.getState().nodes,
  schema: () => schemaOf(useOutlineStore.getState()),
  index: () => useOutlineStore.getState().index,
};

/** The graph, read by this component: it re-renders when what it read changes. */
export function useGraphRead(): GraphRead {
  return useGraphReadThrough(outlineGraph);
}
