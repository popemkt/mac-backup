import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import {
  ONTOLOGY_LIST,
  ONTOLOGY_NAMESPACE,
  ONTOLOGY_SCOPE,
  matchOntologyList,
  matchOntologyScope,
  viewOf,
} from "@/components/ontology/routes";
import {
  OntologyChrome,
  OntologyListSurface,
  OntologySection,
  OntologySurface,
} from "@/components/ontology/surfaces";
import { SidebarSectionPoint, SurfacePoint } from "@/lib/plugins";

/** Ontologies: the list, one ontology's scope in three views, and the sidebar section. */
export const ontologyUiPlugin = definePlugin({
  name: ONTOLOGY_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(SurfacePoint, {
          id: ONTOLOGY_LIST,
          value: {
            match: matchOntologyList,
            frame: () => "scroll",
            pendingTitle: () => "Opening ontology…",
            Component: OntologyListSurface,
          },
        }),
        ctx.contribute(SurfacePoint, {
          id: ONTOLOGY_SCOPE,
          value: {
            match: matchOntologyScope,
            frame: (params) => (viewOf(params) === "graph" ? "full" : "scroll"),
            pendingTitle: (params) =>
              viewOf(params) === "graph" ? "Opening graph…" : "Opening ontology…",
            Chrome: OntologyChrome,
            Component: OntologySurface,
          },
        }),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 20, Component: OntologySection },
        }),
      ],
      { discard: true },
    ),
});
