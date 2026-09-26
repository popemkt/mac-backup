import type { OntologyScopeParams } from "@/components/ontology/views";
import type { NoParams } from "@/lib/plugins";

export function matchOntologyList(path: string): NoParams | null {
  return path === "/o" || path === "/o/" ? {} : null;
}

/** `/o/<id>` (page) · `/o/<id>/outline` · `/o/<id>/graph`: one ontology's scope. */
export function matchOntologyScope(path: string): OntologyScopeParams | null {
  const match = /^\/o\/([^/]+)(?:\/(outline|graph))?\/?$/.exec(path);
  const id = match?.[1];
  if (id === undefined) return null;
  const view = match?.[2];
  return {
    id: decodeURIComponent(id),
    view: view === "outline" || view === "graph" ? view : "page",
  };
}
