/**
 * The collection views: a frame's rows laid out as a node set, a table, a
 * board or a grid of cards, rather than nested as the outline nests them.
 * Each is a frame view (`frameViewKey`, `@kb/views`): its settings are the
 * frame's view node props, and it pages into the outline at its frame. Their
 * ids are frozen data, the `outline.` ids they were first stored under.
 */
import { Schema } from "effect";
import { FRAME_HOST, FRAME_SETTINGS, frameViewKey } from "@kb/views";

/** A frame's rows as one sorted, paged run, a column per field. */
export const CollectionTableView = frameViewKey(
  "outline.table",
  "Table",
  Schema.Struct({
    filters: FRAME_SETTINGS.filters,
    sort: FRAME_SETTINGS.sort,
    display: FRAME_SETTINGS.display,
    colwidth: FRAME_SETTINGS.colwidth,
    pagesize: FRAME_SETTINGS.pagesize,
  }).annotate({
    description: "A frame's rows as one sorted, paged run, a column per field." + FRAME_HOST,
  }),
  "rows",
);

/** A frame's rows as cards, a column per value of its group field. */
export const CollectionBoardView = frameViewKey(
  "outline.board",
  "Board",
  Schema.Struct({
    filters: FRAME_SETTINGS.filters,
    sort: FRAME_SETTINGS.sort,
    display: FRAME_SETTINGS.display,
    groupFieldId: FRAME_SETTINGS.groupFieldId,
  }).annotate({
    description:
      "A frame's rows as cards, a column per value of its group field (groupFieldId)." + FRAME_HOST,
  }),
  "columns",
);

/** A frame's rows as cards in one grid. */
export const CollectionCardsView = frameViewKey(
  "outline.cards",
  "Cards",
  Schema.Struct({
    filters: FRAME_SETTINGS.filters,
    sort: FRAME_SETTINGS.sort,
    display: FRAME_SETTINGS.display,
  }).annotate({
    description: "A frame's rows as cards in one grid." + FRAME_HOST,
  }),
  "columns",
);
