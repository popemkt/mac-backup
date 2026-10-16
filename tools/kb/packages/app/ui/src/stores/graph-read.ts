/**
 * The page's graph as a graph source (`@kb/ui-sdk` → `lib/graph-read`):
 * what a row's tracked read of the graph answers from — the rows of the
 * projection the page stands in (`pageRows`), and the graph store's schema
 * and index. The page's `BrowserHost` answers its
 * graph reads from this same source.
 */
import { type GraphSource, schemaOf } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { pageRows, subscribePage } from "@/stores/page";

export const pageGraph: GraphSource = {
  subscribe: subscribePage,
  nodes: pageRows,
  schema: () => schemaOf(useGraphStore.getState()),
  index: () => useGraphStore.getState().index,
};
