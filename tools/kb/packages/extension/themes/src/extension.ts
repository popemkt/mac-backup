/**
 * The themes family's declaration and its shared plugin (DESIGN.md →
 * Extension families). It contributes the design systems kb ships beside
 * core's default (DESIGN-UI.md → Design tokens → Design systems): Paper and
 * Terminal, page-wide skins owned by no view family. It declares its
 * systems, so the seed derives each one's option under
 * `sys.f.design-system`, and contributes them in its browser half; it
 * declares no view, so its shared plugin is its declaration's, empty on
 * both hosts. It is optional and on by default; switched off, the page
 * offers core's default and whatever other family contributes a design
 * system, and a page painted in one of its systems falls to the default.
 */
import { declarationPlugin, defineExtension } from "@kb/contracts";
import type { SeedOption } from "@kb/model";
import type { Plugin } from "@kb/plugin";

/** Warm off-white and ink, an ink-blue accent and the platform serif. */
export const PAPER_DESIGN_SYSTEM: SeedOption = { id: "themes.paper", label: "Paper" };
/** Dark-first phosphor green, one monospace face throughout. */
export const TERMINAL_DESIGN_SYSTEM: SeedOption = { id: "themes.terminal", label: "Terminal" };

export const themesExtension = defineExtension({
  name: "themes",
  label: "Themes",
  optional: { byDefault: "on" },
  designSystems: [PAPER_DESIGN_SYSTEM, TERMINAL_DESIGN_SYSTEM],
});

/** The themes family's shared plugin: its declaration's, on either host. */
export function themesPlugin(): Plugin {
  return declarationPlugin(themesExtension);
}
