import { viewKey, type NoParams } from "@/lib/plugins";
import type { OntologyView } from "@/lib/router";

/** The ontology plugin's namespace and view keys: what a host imports, never the components. */
export const ONTOLOGY_NAMESPACE = "ontology";

export interface OntologyScopeParams {
  /** The `#ontology` node's id. */
  readonly id: string;
  /** Which projection of the scope: the definition page, the outline, or the graph. */
  readonly view: OntologyView;
}

/** Every ontology in the workspace. */
export const OntologyListView = viewKey<NoParams>()(`${ONTOLOGY_NAMESPACE}.list`);

/** One ontology's scope, projected onto the view its params name. */
export const OntologyScopeView = viewKey<OntologyScopeParams>()(`${ONTOLOGY_NAMESPACE}.scope`);
