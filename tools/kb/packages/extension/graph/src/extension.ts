/**
 * The graph family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's
 * name, seed and views: the graph page, its five renderers in the order the
 * renderer switch offers them, and a node's neighbourhood. The bundled seed
 * folds it, and both hosts' entries are {@link graphPlugin}: the server's
 * directly, the page's as a child of `@kb/graph-ui`'s entry. It is optional
 * and on by default.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { graphSeedNodes } from "./seed.ts";
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
});

/** The graph family's shared plugin: its declaration's views, on either host. */
export function graphPlugin(): Plugin {
  return declarationPlugin(graphExtension);
}
