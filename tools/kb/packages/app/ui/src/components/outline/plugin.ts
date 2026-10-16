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
import { ViewFilterPopoverHost } from "@/components/outline/view-filter-popover";
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
  CommandPoint,
  OverlayPoint,
  PageEditorService,
  PageProjectionService,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  SYSTEM_IDS,
  ViewPoint,
} from "@kb/ui-sdk";
import { ListBulletsIcon, SquaresFourIcon, TableIcon } from "@phosphor-icons/react";
import { outlineProjection, useOutlineStore } from "@/components/outline/outline.store";
import { OUTLINE_COMMANDS } from "@/components/outline/outline-commands";

const { filters, sort, display, colwidth, pagesize, groupFieldId } = DEFAULT_VIEW_CONFIG;

/**
 * The outline's views: its page, its four frame views — each shown inline,
 * under the row of the frame whose children it lays out, and named for the
 * toolbar, the node menu and its `sys.command` node by its `picker`, in the
 * order they are offered — and its read-only snippet.
 */
const OUTLINE_VIEWS = [
  provideView(OutlineView, {
    placements: ["page"],
    sample: {},
    Component: OutlineSurface,
  }),
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
  provideView(OutlineSnippetView, {
    placements: ["inline"],
    sample: { root: "n.root-a", depth: 1, maxRows: 6 },
    Component: OutlineSnippet,
  }),
];

/**
 * The outline: its views, the route to its page at `/`, the Home and Pinned
 * sidebar sections, its expand-all and collapse-all commands, and the page
 * overlay that hosts a frame's filter popover.
 */
export const outlineUiPlugin = definePlugin({
  name: OUTLINE_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        // The page stands in the outline while this plugin is loaded: the
        // outline is its projection, which the graph store tells of each move
        // and the shell reads rows and reveals through, and its store is the
        // page's editor. Unloading leaves the page as a page move does (an
        // empty row it minted is pruned), and the shell then reads no
        // projection and no editor; the outline's own state stays where it
        // was. Loaded again, it follows the graph as a fresh load: the
        // expansion is read from storage again, and the focus and transient
        // rows start empty.
        ctx.provide(PageProjectionService, outlineProjection),
        ctx.provide(PageEditorService, useOutlineStore),
        ...OUTLINE_VIEWS.map((view) => ctx.contribute(ViewPoint, view)),
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
        ...OUTLINE_COMMANDS.map((command) =>
          ctx.contribute(CommandPoint, { id: command.id, value: command }),
        ),
        ctx.contribute(OverlayPoint, {
          id: "view-filter",
          value: { order: 0, Component: ViewFilterPopoverHost },
        }),
      ],
      { discard: true },
    ),
});
