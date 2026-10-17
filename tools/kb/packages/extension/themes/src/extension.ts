/**
 * The themes family's declaration and its shared plugin (DESIGN.md →
 * Extension families). It contributes the design systems kb ships beside
 * core's default (DESIGN-UI.md → Design tokens → Design systems): Paper and
 * Terminal, page-wide skins owned by no view family. It declares no view, so
 * its shared plugin is its declaration's, empty on both hosts. It is
 * optional and on by default; switched off, the page offers core's default
 * and whatever other family contributes a design system.
 */
import { declarationPlugin, defineExtension } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";

export const themesExtension = defineExtension({
  name: "themes",
  label: "Themes",
  optional: { byDefault: "on" },
});

/** The themes family's shared plugin: its declaration's, on either host. */
export function themesPlugin(): Plugin {
  return declarationPlugin(themesExtension);
}
