import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { LAB_SCENE_IDS, LabView, labExtension, labPlugin } from "@kb/lab";
import { matchLab } from "@/components/lab/routes";
import { LabSection, LabSurface } from "@/components/lab/surfaces";
import {
  BrowserHostService,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@/sdk";

/**
 * The lab: stylised real-time 3D projections of the graph, tried here before
 * anything reaches a working view. Optional and off by default: the server
 * loads the lab family only while a person has it switched on, and the page
 * loads this entry only while the server reports it (`ui-plugins.ts`), so
 * its view, its route and its sidebar row exist only then.
 *
 * It is the lab family's page entry, so it loads the family's shared plugin
 * as a child: the lab page's key reaches the page kernel's catalog from the
 * family, as the server's does.
 */
export const labUiPlugin = definePlugin({
  name: labExtension.name,
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(labPlugin()),
        ctx.contribute(
          ViewPoint,
          provideView(LabView, {
            placements: ["page"],
            sample: { scene: LAB_SCENE_IDS[0] },
            Component: LabSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: LabView,
            match: matchLab,
            entry: "/lab",
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
