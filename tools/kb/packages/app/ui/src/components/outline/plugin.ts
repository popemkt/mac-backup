import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { BoardFrameView, CardsFrameView, TableFrameView } from "@/components/outline/frame-views";
import { ListFrameView } from "@/components/outline/node-block";
import { matchOutline } from "@/components/outline/routes";
import { HomeSection, OutlineSurface, PinnedSection } from "@/components/outline/surfaces";
import { OutlineView } from "@/components/outline/views";
import {
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@/lib/plugins";
import {
  DEFAULT_VIEW_CONFIG,
  OUTLINE_NAMESPACE,
  OutlineBoardView,
  OutlineCardsView,
  OutlineListView,
  OutlineTableView,
} from "@/lib/view-config";

const { filters, sort, display, colwidth, pagesize, groupFieldId } = DEFAULT_VIEW_CONFIG;

/**
 * The outline: its page, the route to it at `/`, the Home and Pinned sidebar
 * sections, and its four frame views — each shown inline, under the row of the
 * frame whose children it lays out.
 */
export const outlineUiPlugin = definePlugin({
  name: OUTLINE_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(OutlineView, {
            placements: ["page"],
            sample: {},
            Component: OutlineSurface,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OutlineListView, {
            placements: ["inline"],
            sample: { filters },
            Component: ListFrameView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OutlineTableView, {
            placements: ["inline"],
            sample: { filters, sort, display, colwidth, pagesize },
            Component: TableFrameView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OutlineBoardView, {
            placements: ["inline"],
            sample: { filters, sort, display, groupFieldId },
            Component: BoardFrameView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OutlineCardsView, {
            placements: ["inline"],
            sample: { filters, sort, display },
            Component: CardsFrameView,
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
