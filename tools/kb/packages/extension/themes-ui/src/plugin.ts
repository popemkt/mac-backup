import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import {
  PAPER_DESIGN_SYSTEM,
  TERMINAL_DESIGN_SYSTEM,
  themesExtension,
  themesPlugin,
} from "@kb/themes";
import { DesignSystemPoint, provideDesignSystem } from "@kb/ui-sdk";
import paper from "./design-systems/paper.css?raw";
import terminal from "./design-systems/terminal.css?raw";

/**
 * The themes family's page entry: Paper and Terminal, each contributed to
 * `DesignSystemPoint` under the key its family declares, with its sheet,
 * which the page adds while this plugin is loaded, and the family's shared
 * plugin as a child.
 */
export const themesUiPlugin = definePlugin({
  name: themesExtension.name,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(themesPlugin()),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(PAPER_DESIGN_SYSTEM, { stylesheet: paper }),
        ),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(TERMINAL_DESIGN_SYSTEM, { stylesheet: terminal }),
        ),
      ],
      { discard: true },
    ),
});
