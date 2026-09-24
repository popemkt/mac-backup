import type { SurfaceParams } from "@/lib/plugins";
import type { OntologyView } from "@/lib/router";

/** The ontology plugin's namespace and surface ids, derived once. */
export const ONTOLOGY_NAMESPACE = "ontology";
export const ONTOLOGY_LIST = "list";
export const ONTOLOGY_SCOPE = "scope";
export const ONTOLOGY_LIST_SURFACE = `${ONTOLOGY_NAMESPACE}.${ONTOLOGY_LIST}`;
/** `/o/<id>` (page) · `/o/<id>/outline` · `/o/<id>/graph`: one ontology's scope. */
export const ONTOLOGY_SURFACE = `${ONTOLOGY_NAMESPACE}.${ONTOLOGY_SCOPE}`;

export function matchOntologyList(path: string): SurfaceParams | null {
  return path === "/o" || path === "/o/" ? {} : null;
}

export function matchOntologyScope(path: string): SurfaceParams | null {
  const match = /^\/o\/([^/]+)(?:\/(outline|graph))?\/?$/.exec(path);
  const id = match?.[1];
  if (id === undefined) return null;
  return { id: decodeURIComponent(id), view: match?.[2] ?? "page" };
}

export function viewOf(params: SurfaceParams): OntologyView {
  const view = params["view"];
  return view === "outline" || view === "graph" ? view : "page";
}
