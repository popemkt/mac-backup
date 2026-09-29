import { Schema } from "effect";
import { viewKey } from "@/lib/plugins";

/** The graph plugin's namespace and view keys: what a host imports, never the components. */
export const GRAPH_NAMESPACE = "graph";

export const GraphParams = Schema.Struct({
  /** A graph perspective node's id; absent means the default perspective. */
  perspective: Schema.optionalKey(Schema.String),
  /** Scopes the graph to one ontology's members, when an ontology embeds it. */
  ontology: Schema.optionalKey(Schema.String),
});
export type GraphParams = typeof GraphParams.Type;

/** The graph: its page at `/graph[/<perspective>]`, and what an ontology's graph view embeds. */
export const GraphView = viewKey(`${GRAPH_NAMESPACE}.page`, GraphParams);
