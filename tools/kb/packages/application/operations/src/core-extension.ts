/**
 * Core declared as the families are (DESIGN.md → Extension families): its
 * own system nodes, the views the shell is built from, in the order the
 * seed derives their options under `sys.views`, with the text a view says
 * itself in where it has one, and its one design system, the default. It is the first declaration the seed fold
 * reads, and both hosts load its views through `declarationPlugin`. A
 * feature's views are its family's declaration's, never core's: the outline's,
 * and the default view type it provides, are `@kb/outline`'s, and the
 * graph's, with its seed, are `@kb/graph`'s.
 */
import { defineExtension, viewDef } from "@kb/contracts";
import { DESIGN_SYSTEM_OPTIONS, systemSeedNodes, type SeedOption } from "@kb/model";
import {
  DocsMarkdownView,
  LayoutView,
  NodeView,
  OntologyListView,
  OntologyScopeView,
} from "@kb/views";

/**
 * Core's design system (DESIGN-UI.md → Design tokens → Design systems):
 * layer 1 itself, under its own id. Core's key has no family part, as it
 * is contributed in the root namespace.
 */
export const KB_DESIGN_SYSTEM: SeedOption = { id: "kb", label: "kb" };

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
  declaredOptions: [{ kind: DESIGN_SYSTEM_OPTIONS, options: [KB_DESIGN_SYSTEM] }],
});
