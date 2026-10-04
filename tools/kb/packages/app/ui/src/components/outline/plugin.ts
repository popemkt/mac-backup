import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import {
  BoardFrameView,
  CardsFrameView,
  ListFrameView,
  TableFrameView,
} from "@/components/outline/frame-views";
import { matchOutline } from "@/components/outline/routes";
import { HomeSection, OutlineSurface, PinnedSection } from "@/components/outline/surfaces";
import {
  OUTLINE_NAMESPACE,
  OutlineBoardView,
  OutlineCardsView,
  OutlineListView,
  OutlineSnippetView,
  OutlineTableView,
  OutlineView,
  DEFAULT_VIEW_CONFIG,
} from "@kb/views";
import { OutlineSnippet } from "@/components/outline/outline-snippet";
import {
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  SYSTEM_IDS,
  ViewPoint,
} from "@kb/ui-sdk";
import { ListBulletsIcon, SquaresFourIcon, TableIcon } from "@phosphor-icons/react";
import { provideFrameViews, withdrawFrameViews } from "@/stores/frame-views";
import { readFrameViews } from "@/components/outline/use-frame-views";

const { filters, sort, display, colwidth, pagesize, groupFieldId } = DEFAULT_VIEW_CONFIG;

/**
 * The outline: its page, the route to it at `/`, the Home and Pinned sidebar
 * sections, and its four frame views — each shown inline, under the row of the
 * frame whose children it lays out, and named for the toolbar, the node menu
 * and its `sys.command` node by its `picker`, in the order they are offered.
 */
export const outlineUiPlugin = definePlugin({
  name: OUTLINE_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        // The store's row walk and the commands read the frame views through
        // their port, wired to the UI kernel while this plugin is loaded.
        Effect.acquireRelease(
          Effect.sync(() => provideFrameViews(readFrameViews)),
          () => Effect.sync(() => withdrawFrameViews(readFrameViews)),
        ),
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
            picker: {
              order: 0,
              glyph: "≡",
              icon: ListBulletsIcon,
              iconWeight: "regular",
              command: SYSTEM_IDS.cmdViewAsList,
            },
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OutlineTableView, {
            placements: ["inline"],
            sample: { filters, sort, display, colwidth, pagesize },
            Component: TableFrameView,
            picker: {
              order: 1,
              glyph: "⊞",
              icon: TableIcon,
              iconWeight: "regular",
              command: SYSTEM_IDS.cmdViewAsTable,
            },
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OutlineBoardView, {
            placements: ["inline"],
            sample: { filters, sort, display, groupFieldId },
            Component: BoardFrameView,
            picker: {
              order: 2,
              glyph: "▥",
              icon: SquaresFourIcon,
              iconWeight: "regular",
              command: SYSTEM_IDS.cmdViewAsBoard,
            },
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OutlineCardsView, {
            placements: ["inline"],
            sample: { filters, sort, display },
            Component: CardsFrameView,
            picker: {
              order: 3,
              glyph: "▦",
              icon: SquaresFourIcon,
              iconWeight: "duotone",
              command: SYSTEM_IDS.cmdViewAsCards,
            },
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(OutlineSnippetView, {
            placements: ["inline"],
            sample: { root: "n.root-a", depth: 1, maxRows: 6 },
            Component: OutlineSnippet,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: OutlineView,
            match: matchOutline,
            entry: "/",
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
