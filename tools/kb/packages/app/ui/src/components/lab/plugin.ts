import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchLab } from "@/components/lab/routes";
import { LabSection, LabSurface } from "@/components/lab/surfaces";
import { LAB_NAMESPACE, LabView } from "@/components/lab/views";
import {
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@/lib/plugins";

/**
 * The lab: stylised real-time 3D projections of the graph, tried here before
 * anything reaches a working view. Optional and off by default — it is in
 * `OPTIONAL_UI_PLUGINS`, not the built-ins — so its view, its route and its
 * sidebar row exist only while the preference has it on.
 */
export const labUiPlugin = definePlugin({
  name: LAB_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(LabView, {
            placements: ["page"],
            Component: LabSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: LabView,
            match: matchLab,
            frame: () => "full",
            pendingTitle: () => "Opening the lab…",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 40, Component: LabSection },
        }),
      ],
      { discard: true },
    ),
});
