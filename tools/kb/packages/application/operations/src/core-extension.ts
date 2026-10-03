/**
 * Core declared as the families are (DESIGN.md → Extension families): its
 * own system nodes and the views the shell is built from, in the order the
 * seed derives their options under `sys.views`, with the text a view says
 * itself in where it has one. It is the first declaration the seed fold
 * reads, and both hosts load its views through `declarationPlugin`.
 *
 * It still lists the feature views (canvas, lab) beside its own,
 * so they reach the catalog and the seed through core rather than their
 * families: GAP [[01M3YM5XYZ4VHEK39RNQ6WWRPK]] and GAP [[01M41H30342XZPX3CXZJTMPBYW]]
 */
import { defineExtension, viewDef } from "@kb/contracts";
import { systemSeedNodes } from "@kb/model";
import {
  CanvasListView,
  CanvasView,
  ClusterView,
  DocsMarkdownView,
  Force2dView,
  Force3dView,
  GraphView,
  LabView,
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
    // The feature views still in core, after core's own, grouped by the
    // family that will take each. The order is `BUNDLED_FAMILIES`'
    // (`@kb/bundled`), which owns it. Each group leaves for its family at the
    // same place in the fold, and the store contract's view-order case fails
    // by name if a group or a family lands elsewhere.
    viewDef(CanvasListView),
    viewDef(CanvasView),
    viewDef(LabView),
  ],
});
