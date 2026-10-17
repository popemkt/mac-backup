/**
 * The graph family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's
 * name, seed and views: the graph page, its five renderers in the order the
 * renderer switch offers them, and a node's neighbourhood; and of its own
 * themes, declared options of the kind it owns (`themes.ts`). The bundled seed
 * folds it. The page's entry loads {@link graphPlugin} as a child of
 * `@kb/graph-ui`'s; the server's is {@link graphServerPlugin}, the same views
 * with the family's actions. It is optional and on by default.
 */
import { Effect } from "effect";
import { declarationPlugin, defineExtension, extensionPlugin, viewDef } from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { GRAPH_ACTIONS } from "./actions.ts";
import { graphSeedNodes } from "./seed.ts";
import {
  BULLET_THEME,
  CEL_THEME,
  CUBE_THEME,
  FRESNEL_THEME,
  GLASS_THEME,
  GRAPH_THEME_OPTIONS,
  MATTE_THEME,
} from "./themes.ts";
import {
  ClusterView,
  Force2dView,
  Force3dView,
  GraphView,
  NeighbourhoodView,
  TreeView,
  TreemapView,
} from "./views.ts";

export const graphExtension = defineExtension({
  name: "graph",
  label: "Graph",
  optional: { byDefault: "on" },
  seed: graphSeedNodes,
  views: [
    viewDef(GraphView),
    viewDef(Force2dView),
    viewDef(TreeView),
    viewDef(ClusterView),
    viewDef(Force3dView),
    viewDef(TreemapView),
    viewDef(NeighbourhoodView),
  ],
  declaredOptions: [
    {
      kind: GRAPH_THEME_OPTIONS,
      options: [MATTE_THEME, CEL_THEME, FRESNEL_THEME, GLASS_THEME, BULLET_THEME, CUBE_THEME],
    },
  ],
});

/** The graph family's shared plugin: its declaration's views, on either host. */
export function graphPlugin(): Plugin {
  return declarationPlugin(graphExtension);
}

/**
 * The graph family's server entry: its actions, `ext.graph.*`, with the
 * shared plugin loaded as a child. The actions are isomorphic too (they
 * read `KbCtx` and run `read.ts`), but only the server dispatches actions;
 * the page answers the same reads by calling `read.ts` over its replica.
 */
export function graphServerPlugin(): Plugin {
  const actions = extensionPlugin({
    name: graphExtension.name,
    actions: GRAPH_ACTIONS,
    templates: [],
  });
  return definePlugin({
    ...actions,
    apply: (ctx) => Effect.all([actions.apply(ctx), ctx.plugin(graphPlugin())], { discard: true }),
  });
}
