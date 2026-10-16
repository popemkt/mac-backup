/**
 * Core declared as the families are (DESIGN.md → Extension families): its
 * own system nodes and the views the shell is built from, in the order the
 * seed derives their options under `sys.views`, with the text a view says
 * itself in where it has one. It is the first declaration the seed fold
 * reads, and both hosts load its views through `declarationPlugin`. A
 * feature's views are its family's declaration's, never core's. The outline,
 * the default editing mode, is still declared here, so this declaration
 * provides the default view type (`defaultView`) until the outline's own
 * declaration does; the option id it names is frozen either way.
 */
import { defineExtension, viewDef } from "@kb/contracts";
import { systemSeedNodes } from "@kb/model";
import {
  ClusterView,
  DocsMarkdownView,
  Force2dView,
  Force3dView,
  GraphView,
  LayoutView,
  NeighbourhoodView,
  NodeView,
  OntologyListView,
  OntologyScopeView,
  OutlineBoardView,
  OutlineCardsView,
  OutlineListView,
  OutlineSnippetView,
  OutlineTableView,
  OutlineView,
  TreeView,
  TreemapView,
} from "@kb/views";

export const coreExtension = defineExtension({
  name: "core",
  label: "Core",
  seed: systemSeedNodes,
  // Core still declares the outline's views and provides the default view
  // type, until the outline's own declaration does.
  // GAP [[01M52J3DADW4P7YV6907ME9C50]]
  defaultView: OutlineView,
  views: [
    viewDef(OutlineView),
    viewDef(OutlineListView),
    viewDef(OutlineTableView),
    viewDef(OutlineBoardView),
    viewDef(OutlineCardsView),
    viewDef(OutlineSnippetView),
    viewDef(GraphView),
    viewDef(Force2dView),
    viewDef(TreeView),
    viewDef(ClusterView),
    viewDef(Force3dView),
    viewDef(TreemapView),
    viewDef(NeighbourhoodView),
    viewDef(OntologyListView),
    viewDef(OntologyScopeView),
    viewDef(DocsMarkdownView),
    viewDef(LayoutView),
    viewDef(NodeView),
  ],
});
