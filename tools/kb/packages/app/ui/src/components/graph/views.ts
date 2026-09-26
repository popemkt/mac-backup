import { viewKey } from "@/lib/plugins";

/** The graph plugin's namespace and view keys: what a host imports, never the components. */
export const GRAPH_NAMESPACE = "graph";

export interface GraphParams {
  /** A graph perspective node's id; absent means the default perspective. */
  readonly perspective?: string;
  /** Scopes the graph to one ontology's members, when an ontology embeds it. */
  readonly ontology?: string;
}

/** The graph: its page at `/graph[/<perspective>]`, and what an ontology's graph view embeds. */
export const GraphView = viewKey<GraphParams>()(`${GRAPH_NAMESPACE}.page`);
