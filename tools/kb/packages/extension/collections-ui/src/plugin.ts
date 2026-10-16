import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import {
  CollectionBoardView,
  CollectionCardsView,
  CollectionTableView,
  collectionsExtension,
  collectionsPlugin,
} from "@kb/collections";
import { DEFAULT_VIEW_CONFIG } from "@kb/views";
import { BrowserHostService, provideView, SYSTEM_IDS, ViewPoint } from "@kb/ui-sdk";
import { SquaresFourIcon, TableIcon } from "@phosphor-icons/react";
import { BoardFrameView, CardsFrameView, TableFrameView } from "./frame-views";

const { filters, sort, display, colwidth, pagesize, groupFieldId } = DEFAULT_VIEW_CONFIG;

/**
 * The collection views: each shown inline, under the row of the frame whose
 * rows it lays out, and named for the toolbar, the node menu and its
 * `sys.command` node by its `picker`, offered after the outline's list.
 */
const COLLECTION_VIEWS = [
  provideView(CollectionTableView, {
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
  provideView(CollectionBoardView, {
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
  provideView(CollectionCardsView, {
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
];

/**
 * The collections family's page entry: its three frame views. It loads the
 * family's shared plugin as a child, so the views' keys reach the page
 * kernel's catalog from the family, as the server's do, and it applies after
 * the host, through which its views read the page.
 */
export const collectionsUiPlugin = definePlugin({
  name: collectionsExtension.name,
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(collectionsPlugin()),
        // The views' ids are frozen in the outline's namespace (`outline.table`),
        // so each answers to its key's id as an alias of the id it is given here.
        ...COLLECTION_VIEWS.map((view) =>
          ctx.contribute(ViewPoint, { ...view, aliases: [view.value.key.id] }),
        ),
      ],
      { discard: true },
    ),
});
