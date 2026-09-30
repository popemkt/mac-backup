import { Schema } from "effect";
import { firstRef } from "@kb/model";
import { SYSTEM_IDS } from "@/lib/types";
import {
  FRAME_SETTINGS,
  FRAME_VIEW_FAMILY,
  getViewConfig,
  type FrameViewKey,
  type FrameViewParams,
} from "@/lib/view-config";
import { NoParams, viewKey } from "@/lib/view-key";

/** The outline plugin's namespace and view keys: what a host imports, never the components. */
export const OUTLINE_NAMESPACE = "outline";

/** The outline, at `/`: a zoom lives in the store, not in the params. */
export const OutlineView = viewKey(`${OUTLINE_NAMESPACE}.main`, NoParams);

/**
 * A read-only glimpse of the outline under `root`: its text, then its
 * descendants `depth` levels down, at most `maxRows` rows. What a graph hover
 * or a card shows of a node; editing stays the outline's.
 */
export const OutlineSnippetParams = Schema.Struct({
  root: Schema.NonEmptyString,
  depth: Schema.Literals([0, 1, 2]),
  maxRows: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type OutlineSnippetParams = typeof OutlineSnippetParams.Type;

/**
 * Stored, `lens.focus` is the root, and an empty focus means the node it is
 * shown for; nothing stored sets its depth or row cap, so a stored snippet
 * shows one level and six rows.
 */
export const OutlineSnippetView = viewKey(
  `${OUTLINE_NAMESPACE}.snippet`,
  OutlineSnippetParams,
  (props, host) => ({
    root: firstRef(SYSTEM_IDS.lensFocusField)(props) ?? host ?? undefined,
    depth: 1,
    maxRows: 6,
  }),
);

function frameViewKey<P extends FrameViewParams>(
  name: string,
  params: Schema.Decoder<P>,
  rows: FrameViewKey["rows"],
): FrameViewKey<P> {
  // A frame view's settings are the `sys.f.view.*` props that configure it.
  return {
    ...viewKey(`${OUTLINE_NAMESPACE}.${name}`, params, (props) => getViewConfig(props)),
    family: FRAME_VIEW_FAMILY,
    rows,
  };
}

/** A frame's children as the outline shows them, nested. */
export const OutlineListView = frameViewKey(
  "list",
  Schema.Struct({ filters: FRAME_SETTINGS.filters }),
  "outline",
);

/** A frame's rows as one sorted, paged run, a column per field. */
export const OutlineTableView = frameViewKey(
  "table",
  Schema.Struct({
    filters: FRAME_SETTINGS.filters,
    sort: FRAME_SETTINGS.sort,
    display: FRAME_SETTINGS.display,
    colwidth: FRAME_SETTINGS.colwidth,
    pagesize: FRAME_SETTINGS.pagesize,
  }),
  "rows",
);

/** A frame's rows as cards, a column per value of its group field. */
export const OutlineBoardView = frameViewKey(
  "board",
  Schema.Struct({
    filters: FRAME_SETTINGS.filters,
    sort: FRAME_SETTINGS.sort,
    display: FRAME_SETTINGS.display,
    groupFieldId: FRAME_SETTINGS.groupFieldId,
  }),
  "columns",
);

/** A frame's rows as cards in one grid. */
export const OutlineCardsView = frameViewKey(
  "cards",
  Schema.Struct({
    filters: FRAME_SETTINGS.filters,
    sort: FRAME_SETTINGS.sort,
    display: FRAME_SETTINGS.display,
  }),
  "columns",
);
