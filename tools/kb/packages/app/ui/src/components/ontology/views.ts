import { Schema } from "effect";
import { NoParams, viewKey } from "@/lib/plugins";
import { ONTOLOGY_VIEWS } from "@/lib/router";

/** The ontology plugin's namespace and view keys: what a host imports, never the components. */
export const ONTOLOGY_NAMESPACE = "ontology";

export const OntologyScopeParams = Schema.Struct({
  /** The `#ontology` node's id. */
  id: Schema.String,
  /** Which projection of the scope: the definition page, the outline, or the graph. */
  view: Schema.Literals(ONTOLOGY_VIEWS),
});
export type OntologyScopeParams = typeof OntologyScopeParams.Type;

/** Every ontology in the workspace. */
export const OntologyListView = viewKey(`${ONTOLOGY_NAMESPACE}.list`, NoParams);

/** One ontology's scope, projected onto the view its params name. */
export const OntologyScopeView = viewKey(`${ONTOLOGY_NAMESPACE}.scope`, OntologyScopeParams);
