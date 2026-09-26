import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchOntologyList, matchOntologyScope } from "@/components/ontology/routes";
import {
  OntologyChrome,
  OntologyListSurface,
  OntologySection,
  OntologySurface,
} from "@/components/ontology/surfaces";
import {
  ONTOLOGY_NAMESPACE,
  OntologyListView,
  OntologyScopeView,
} from "@/components/ontology/views";
import {
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@/lib/plugins";

/** Ontologies: the list, one ontology's scope in three views, their routes, and the section. */
export const ontologyUiPlugin = definePlugin({
  name: ONTOLOGY_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(OntologyListView, {
            placements: ["page"],
            Component: OntologyListSurface,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OntologyScopeView, {
            placements: ["page"],
            Component: OntologySurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: OntologyListView,
            match: matchOntologyList,
            frame: () => "scroll",
            pendingTitle: () => "Opening ontology…",
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: OntologyScopeView,
            match: matchOntologyScope,
            frame: (params) => (params.view === "graph" ? "full" : "scroll"),
            pendingTitle: (params) =>
              params.view === "graph" ? "Opening graph…" : "Opening ontology…",
            Chrome: OntologyChrome,
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 20, Component: OntologySection },
        }),
      ],
      { discard: true },
    ),
});
