import { Schema } from "effect";
import { SYSTEM_IDS, firstRef } from "@kb/model";
import {
  FRAME_SETTINGS,
  FRAME_VIEW_FAMILY,
  decodeFrameConfig,
  encodeFrameConfig,
  type FrameViewKey,
  type FrameViewParams,
} from "./frame.ts";
import { encodeLensConfig } from "./lens.ts";
import { viewKey } from "./view-key.ts";

/** The outline plugin's namespace and view keys: what a host imports, never the components. */
export const OUTLINE_NAMESPACE = "outline";

/** What every frame view says of the node it is shown for. */
const FRAME_HOST = " Shown for a frame (the node it is named by): lays out that frame's children.";

/**
 * The outline, rooted at `root`; without one, at the outline's zoom, which
 * lives in the store (`/`).
 */
export const OutlineParams = Schema.Struct({
  root: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({
  description:
    "The outline: nodes as an editable tree, rooted at root, or at the outline's zoom (/) when there is none. Stored, root is lens.focus, else the node it is shown for.",
});
export type OutlineParams = typeof OutlineParams.Type;

export const OutlineView = viewKey(`${OUTLINE_NAMESPACE}.main`, OutlineParams, {
  read: (props, host) => {
    const root = firstRef(SYSTEM_IDS.lensFocusField)(props) ?? host ?? undefined;
    return root === undefined ? {} : { root };
  },
  write: ({ root }) => (root === undefined ? {} : encodeLensConfig({ focus: root })),
});

/**
 * A read-only glimpse of the outline under `root`: its text, then its
 * descendants `depth` levels down, at most `maxRows` rows. What a graph hover
 * or a card shows of a node; editing stays the outline's.
 */
export const OutlineSnippetParams = Schema.Struct({
  root: Schema.NonEmptyString,
  depth: Schema.Literals([0, 1, 2]),
  maxRows: Schema.Int.check(Schema.isGreaterThan(0)),
}).annotate({
  description:
    "A read-only glimpse of the outline under root: its text, then its descendants depth levels down, at most maxRows rows. Stored, root is lens.focus, else the node it is shown for, and a stored snippet shows depth 1 and 6 rows.",
});
export type OutlineSnippetParams = typeof OutlineSnippetParams.Type;

/**
 * Stored, `lens.focus` is the root, and an empty focus means the node it is
 * shown for; nothing stored sets its depth or row cap, so a stored snippet
 * shows one level and six rows.
 */
export const OutlineSnippetView = viewKey(`${OUTLINE_NAMESPACE}.snippet`, OutlineSnippetParams, {
  read: (props, host) => ({
    root: firstRef(SYSTEM_IDS.lensFocusField)(props) ?? host ?? undefined,
    depth: 1,
    maxRows: 6,
  }),
  write: ({ root }) => encodeLensConfig({ focus: root }),
});

function frameViewKey<P extends FrameViewParams>(
  name: string,
  params: Schema.Decoder<P>,
  rows: FrameViewKey["rows"],
): FrameViewKey<P> {
  // A frame view's settings are the `sys.f.view.*` props that configure it.
  return {
    ...viewKey<P>(`${OUTLINE_NAMESPACE}.${name}`, params, {
      read: (props, _host, report) => decodeFrameConfig(props, report),
      write: encodeFrameConfig,
    }),
    family: FRAME_VIEW_FAMILY,
    rows,
  };
}

/** A frame's children as the outline shows them, nested. */
export const OutlineListView = frameViewKey(
  "list",
  Schema.Struct({ filters: FRAME_SETTINGS.filters }).annotate({
    description: "A frame's children as the outline shows them, nested, filtered." + FRAME_HOST,
  }),
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
  }).annotate({
    description: "A frame's rows as one sorted, paged run, a column per field." + FRAME_HOST,
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
  }).annotate({
    description:
      "A frame's rows as cards, a column per value of its group field (groupFieldId)." + FRAME_HOST,
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
  }).annotate({
    description: "A frame's rows as cards in one grid." + FRAME_HOST,
  }),
  "columns",
);
