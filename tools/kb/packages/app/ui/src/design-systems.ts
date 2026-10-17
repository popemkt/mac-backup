/**
 * Core's design system (DESIGN-UI.md → Design tokens → Design systems),
 * contributed to `DesignSystemPoint` like any family's, and the only one
 * core has: every other is a family's (kb's are the themes family's). The
 * default, `kb`, is layer 1 itself (`design-system.css`, always on the
 * page, whose blocks also answer to `[data-theme="kb"]`), so it adds no
 * sheet. Core's plugins load before every family's, so it is the first
 * contributed: what the page paints while no contributed system is chosen.
 */
import { definePlugin } from "@kb/plugin";
import { DesignSystemPoint, provideDesignSystem, type DesignSystemKey } from "@kb/ui-sdk";

/** Core's default: layer 1, under its own id. */
const KB_DESIGN_SYSTEM: DesignSystemKey = { id: "kb", label: "kb" };

export const designSystemsUiPlugin = definePlugin({
  name: "design-systems",
  namespace: "",
  apply: (ctx) =>
    ctx.contribute(DesignSystemPoint, provideDesignSystem(KB_DESIGN_SYSTEM, { stylesheet: "" })),
});
