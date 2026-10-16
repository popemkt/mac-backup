/**
 * Core declared as the families are (DESIGN.md → Extension families): its
 * own system nodes and the views the shell is built from, in the order the
 * seed derives their options under `sys.views`, with the text a view says
 * itself in where it has one. It is the first declaration the seed fold
 * reads, and both hosts load its views through `declarationPlugin`. A
 * feature's views are its family's declaration's, never core's: the outline's,
 * and the default view type it provides, are `@kb/outline`'s, and the
 * graph's, with its seed, are `@kb/graph`'s.
 */
import { defineExtension, viewDef } from "@kb/contracts";
import { systemSeedNodes } from "@kb/model";
import {
  DocsMarkdownView,
  LayoutView,
  NodeView,
  OntologyListView,
  OntologyScopeView,
} from "@kb/views";

export const coreExtension = defineExtension({
  name: "core",
  label: "Core",
  seed: systemSeedNodes,
  views: [
    viewDef(OntologyListView),
    viewDef(OntologyScopeView),
    viewDef(DocsMarkdownView),
    viewDef(LayoutView),
    viewDef(NodeView),
  ],
});
