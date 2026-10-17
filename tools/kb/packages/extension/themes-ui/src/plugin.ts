import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { themesExtension, themesPlugin } from "@kb/themes";
import { DesignSystemPoint, provideDesignSystem, type DesignSystemKey } from "@kb/ui-sdk";
import paper from "./design-systems/paper.css?raw";
import terminal from "./design-systems/terminal.css?raw";

/** Warm off-white and ink, an ink-blue accent and the platform serif. */
const PAPER: DesignSystemKey = { id: "themes.paper", label: "Paper" };
/** Dark-first phosphor green, one monospace face throughout. */
const TERMINAL: DesignSystemKey = { id: "themes.terminal", label: "Terminal" };

/**
 * The themes family's page entry: Paper and Terminal, each contributed to
 * `DesignSystemPoint` with its sheet, which the page adds while this plugin
 * is loaded, with the family's shared plugin as a child.
 */
export const themesUiPlugin = definePlugin({
  name: themesExtension.name,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(themesPlugin()),
        ctx.contribute(DesignSystemPoint, provideDesignSystem(PAPER, { stylesheet: paper })),
        ctx.contribute(DesignSystemPoint, provideDesignSystem(TERMINAL, { stylesheet: terminal })),
      ],
      { discard: true },
    ),
});
