import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { ListFrameView } from "./frame-views";
import { matchOutline } from "./routes";
import { HomeSection, OutlineSurface, PinnedSection } from "./surfaces";
import { ViewFilterPopoverHost } from "./view-filter-popover";
import { outlineExtension, outlinePlugin } from "@kb/outline";
import { OutlineListView, OutlineSnippetView, OutlineView, DEFAULT_VIEW_CONFIG } from "@kb/views";
import { OutlineSnippet } from "./outline-snippet";
import {
  BrowserHostService,
  CommandPoint,
  FieldEditorService,
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
import { ListBulletsIcon } from "@phosphor-icons/react";
import { NodeField } from "./fields-section";
import { outlineProjection, useOutlineStore } from "./outline.store";
import { OUTLINE_COMMANDS } from "./outline-commands";

const { filters } = DEFAULT_VIEW_CONFIG;

/**
 * The outline's views: its page, its list frame view — shown inline, under
 * the row of the frame whose children it lays out, and named for the
 * toolbar, the node menu and its `sys.command` node by its `picker`, first
 * of the frame views offered — and its read-only snippet. The other frame
 * views are the collections family's (`@kb/collections-ui`).
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
 *
 * It reaches the page through the host (its projection and editor read the
 * graph through it), so it injects `BrowserHostService` and applies after the
 * host. It is the outline family's page entry, so it loads the family's shared
 * plugin as a child: the outline views' keys reach the page kernel's catalog
 * from the family, as the server's do.
 */
export const outlineUiPlugin = definePlugin({
  name: outlineExtension.name,
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(outlinePlugin()),
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
        // Its field row is the page's field editor, wherever a field is drawn.
        ctx.provide(FieldEditorService, NodeField),
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
