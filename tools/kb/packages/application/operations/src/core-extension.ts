/**
 * Core declared as the families are (DESIGN.md → Extension families): its
 * own system nodes and the views the shell is built from, in the order the
 * seed derives their options under `sys.views`. It is the first declaration
 * the seed fold reads, and both hosts load its views through
 * `declarationPlugin`.
 *
 * It still lists the feature views (canvas, lab, chart, code) beside its own,
 * so they reach the catalog and the seed through core rather than their
 * families: GAP [[01M3YM5XYZ4VHEK39RNQ6WWRPK]] and GAP [[01M41H30342XZPX3CXZJTMPBYW]]
 */
import { defineExtension } from "@kb/contracts";
import { systemSeedNodes } from "@kb/model";
import {
  CanvasListView,
  CanvasView,
  ChartView,
  ClusterView,
  CodeView,
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
    { key: OutlineView },
    { key: OutlineListView },
    { key: OutlineTableView },
    { key: OutlineBoardView },
    { key: OutlineCardsView },
    { key: OutlineSnippetView },
    { key: GraphView },
    { key: Force2dView },
    { key: TreeView },
    { key: ClusterView },
    { key: Force3dView },
    { key: TreemapView },
    { key: NeighbourhoodView },
    { key: OntologyListView },
    { key: OntologyScopeView },
    { key: CanvasListView },
    { key: CanvasView },
    { key: LabView },
    { key: DocsMarkdownView },
    { key: LayoutView },
    { key: NodeView },
    { key: ChartView },
    { key: CodeView },
  ],
});
