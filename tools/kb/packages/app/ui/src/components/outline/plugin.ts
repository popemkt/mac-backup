import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { OUTLINE_MAIN, OUTLINE_NAMESPACE } from "@/components/outline/routes";
import { HomeSection, OutlineSurface, PinnedSection } from "@/components/outline/surfaces";
import { SidebarSectionPoint, SurfacePoint } from "@/lib/plugins";

/** The outline: its page, and the Home and Pinned sidebar sections. */
export const outlineUiPlugin = definePlugin({
  name: OUTLINE_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(SurfacePoint, {
          id: OUTLINE_MAIN,
          value: {
            match: (path) => (path === "/" ? {} : null),
            frame: () => "scroll",
            pendingTitle: () => "Opening your workspace…",
            Component: OutlineSurface,
          },
        }),
        ctx.contribute(SidebarSectionPoint, {
          id: "home",
          value: { order: 0, Component: HomeSection },
        }),
        ctx.contribute(SidebarSectionPoint, {
          id: "pinned",
          value: { order: 100, Component: PinnedSection },
        }),
      ],
      { discard: true },
    ),
});
