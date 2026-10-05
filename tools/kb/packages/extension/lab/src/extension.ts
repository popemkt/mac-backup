/**
 * The lab family's declaration and its shared plugin (DESIGN.md → Extension
 * families). The declaration is the one home of the family's name and
 * views; the bundled seed folds it, and both hosts load {@link labPlugin},
 * so the key cannot differ between them. The lab declares no system node:
 * its view's option under `sys.views` is derived from its key, and a lab
 * page says itself in the generic text, so its view carries no text of its
 * own. It is optional: the off-by-default sketchbook a person switches on.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { LabView } from "./view.ts";

export const labExtension = defineExtension({
  name: "lab",
  label: "Lab",
  optional: { byDefault: "off" },
  views: [viewDef(LabView)],
});

/**
 * The lab family's shared plugin: its declaration's view. It is the server's
 * entry as it is, and the page's entry loads it as a child.
 */
export function labPlugin(): Plugin {
  return declarationPlugin(labExtension);
}
