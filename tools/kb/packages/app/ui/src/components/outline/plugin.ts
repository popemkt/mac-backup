import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchOutline } from "@/components/outline/routes";
import { HomeSection, OutlineSurface, PinnedSection } from "@/components/outline/surfaces";
import { OUTLINE_NAMESPACE, OutlineView } from "@/components/outline/views";
import {
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@/lib/plugins";

/** The outline: its view, the route to it at `/`, and the Home and Pinned sidebar sections. */
export const outlineUiPlugin = definePlugin({
  name: OUTLINE_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(OutlineView, {
            placements: ["page"],
            Component: OutlineSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: OutlineView,
            match: matchOutline,
            frame: () => "scroll",
            pendingTitle: () => "Opening your workspace…",
          }),
        ),
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
