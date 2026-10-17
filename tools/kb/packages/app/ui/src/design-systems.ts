/**
 * Core's design systems (DESIGN-UI.md → Design tokens → Design systems),
 * contributed to `DesignSystemPoint` like any family's. The default, `kb`,
 * is layer 1 itself (`design-system.css`, always on the page, whose blocks
 * also answer to `[data-theme="kb"]`), so it adds no sheet. Core's plugins
 * load before every family's, so it is the first contributed: what the
 * page paints while no contributed system is chosen.
 */
import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { DesignSystemPoint, provideDesignSystem, type DesignSystemKey } from "@kb/ui-sdk";
import paper from "./design-systems/paper.css?raw";
import terminal from "./design-systems/terminal.css?raw";

/** Core's default: layer 1, under its own id. */
const KB_DESIGN_SYSTEM: DesignSystemKey = { id: "kb", label: "kb" };

export const designSystemsUiPlugin = definePlugin({
  name: "design-systems",
  namespace: "",
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(KB_DESIGN_SYSTEM, { stylesheet: "" }),
        ),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem({ id: "paper", label: "Paper" }, { stylesheet: paper }),
        ),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem({ id: "terminal", label: "Terminal" }, { stylesheet: terminal }),
        ),
      ],
      { discard: true },
    ),
});
