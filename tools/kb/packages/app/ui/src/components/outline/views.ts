import { Schema } from "effect";
import {
  FRAME_SETTINGS,
  FRAME_VIEW_FAMILY,
  type FrameViewKey,
  type FrameViewParams,
} from "@/lib/view-config";
import { NoParams, viewKey } from "@/lib/view-key";

/** The outline plugin's namespace and view keys: what a host imports, never the components. */
export const OUTLINE_NAMESPACE = "outline";

/** The outline, at `/`: a zoom lives in the store, not in the params. */
export const OutlineView = viewKey(`${OUTLINE_NAMESPACE}.main`, NoParams);

function frameViewKey<P extends FrameViewParams>(
  name: string,
  params: Schema.Decoder<P>,
  rows: FrameViewKey["rows"],
): FrameViewKey<P> {
  return { ...viewKey(`${OUTLINE_NAMESPACE}.${name}`, params), family: FRAME_VIEW_FAMILY, rows };
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
