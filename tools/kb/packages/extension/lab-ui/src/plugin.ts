import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { LAB_SCENE_IDS, LabView, labExtension, labPlugin, type LabSceneId } from "@kb/lab";
import { LabStudyPoint } from "./kit/study-point";
import { matchLab } from "./routes";
import { LAB_STUDIES } from "./studies";
import { LabSection, LabSurface } from "./surfaces";
import {
  BrowserHostService,
  NodeLinkGraphService,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";

/** The studies that do, or do not, read the graph, as `LabStudyPoint` contributions. */
function studies(readsGraph: boolean) {
  return LAB_SCENE_IDS.filter(
    (scene) => (LAB_STUDIES[scene].readsGraph === true) === readsGraph,
  ).map((scene: LabSceneId) => ({ id: scene, value: { scene, study: LAB_STUDIES[scene] } }));
}

/**
 * The studies that draw the graph's lens graph: offered only once the graph
 * provides it, so they wait while the graph is off and the lab does not.
 */
const labGraphStudies = definePlugin({
  name: "graph-studies",
  inject: [NodeLinkGraphService],
  apply: (ctx) =>
    Effect.all(
      studies(true).map((entry) => ctx.contribute(LabStudyPoint, entry)),
      { discard: true },
    ),
});

/**
 * The lab: stylised real-time 3D projections of the graph, tried here before
 * anything reaches a working view. Optional and off by default: the server
 * loads the lab family only while a person has it switched on, and the page
 * loads this entry only while the server reports it (`ui-plugins.ts`), so
 * its view, its route and its sidebar row exist only then. Each study is
 * offered at `LabStudyPoint`: a study that reads the graph by the lab's graph
 * child, which injects the graph's `NodeLinkGraphService` and so waits, pending,
 * while the graph is off; every other study by the lab itself.
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
        ctx.plugin(labGraphStudies),
        ...studies(false).map((entry) => ctx.contribute(LabStudyPoint, entry)),
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
