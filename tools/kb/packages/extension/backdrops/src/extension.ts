/**
 * The backdrops family's declaration and its shared plugin (DESIGN.md →
 * Extension families). It contributes the page-head backdrops kb ships
 * (DESIGN-UI.md → Page-head backdrops): ambience every page head can show,
 * owned by no view family, so neither by the outline. It seeds nothing and
 * declares no view: its shared plugin is its declaration's, empty on both
 * hosts, and its contributions are the browser half's. It is optional and on
 * by default; switched off, page heads show whatever other family
 * contributes a backdrop, or none.
 */
import { declarationPlugin, defineExtension } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";

export const backdropsExtension = defineExtension({
  name: "backdrops",
  label: "Backdrops",
  optional: { byDefault: "on" },
});

/** The backdrops family's shared plugin: its declaration's, on either host. */
export function backdropsPlugin(): Plugin {
  return declarationPlugin(backdropsExtension);
}
