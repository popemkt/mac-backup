import { Schema } from "effect";
import { NoParams, viewKey } from "./view-key.ts";

/** The ontology plugin's namespace and view keys: what a host imports, never the components. */
export const ONTOLOGY_NAMESPACE = "ontology";

/** The projections of one ontology's scope, each a path under `/o/<id>`. */
export const ONTOLOGY_VIEWS = ["page", "outline", "graph"] as const;
export type OntologyView = (typeof ONTOLOGY_VIEWS)[number];

/**
 * The view the `graph` projection embeds, by id: the graph family's page.
 * The family may be off, so the ontology names it softly, through the page's
 * catalog, and imports nothing of it; the family's tests hold this id to its
 * key's (`@kb/graph`'s `GraphView`).
 */
export const ONTOLOGY_GRAPH_VIEW = "graph.page";

export const OntologyScopeParams = Schema.Struct({
  /** The `#ontology` node's id. */
  id: Schema.String,
  /** Which projection of the scope: the definition page, the outline, or the graph. */
  view: Schema.Literals(ONTOLOGY_VIEWS),
}).annotate({
  description:
    "One ontology's scope, projected onto the view its params name. Its params come from the route: a view node holds none.",
});
export type OntologyScopeParams = typeof OntologyScopeParams.Type;

/** Every ontology in the workspace. */
export const OntologyListView = viewKey(
  `${ONTOLOGY_NAMESPACE}.list`,
  "Ontologies",
  NoParams.annotate({ description: "Every ontology in the workspace. It reads no settings." }),
);

/** One ontology's scope, projected onto the view its params name. */
export const OntologyScopeView = viewKey(
  `${ONTOLOGY_NAMESPACE}.scope`,
  "Ontology",
  OntologyScopeParams,
);
