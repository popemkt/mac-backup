/**
 * Core's design system (DESIGN-UI.md → Design tokens → Design systems),
 * contributed to `DesignSystemPoint` like any family's, and the only one
 * core has: every other is a family's (kb's are the themes family's). The
 * default, `kb`, is layer 1 itself (`design-system.css`, always on the
 * page, whose blocks also answer to `[data-theme="kb"]`), so it adds no
 * sheet. Core's plugins load before every family's, so it is the first
 * contributed: what the page paints while no contributed system is chosen.
 *
 * It also previews the design-system field's options (`OptionPreviewPoint`),
 * whoever contributes them: the field editor draws each with its swatch.
 */
import { Effect } from "effect";
import { DESIGN_SYSTEM_OPTIONS } from "@kb/model";
import { KB_DESIGN_SYSTEM } from "@kb/operations";
import { definePlugin } from "@kb/plugin";
import { DesignSystemPoint, OptionPreviewPoint, provideDesignSystem } from "@kb/ui-sdk";
import { DesignSystemSwatch } from "@/design-system-swatch";

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
        ctx.contribute(OptionPreviewPoint, {
          id: "design-system",
          value: { kind: DESIGN_SYSTEM_OPTIONS, Preview: DesignSystemSwatch },
        }),
      ],
      { discard: true },
    ),
});
