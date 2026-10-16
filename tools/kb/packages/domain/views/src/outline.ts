import { Schema } from "effect";
import {
  FRAME_SETTINGS,
  FRAME_VIEW_FAMILY,
  decodeFrameConfig,
  encodeFrameConfig,
  type FrameViewKey,
  type FrameViewParams,
} from "./frame.ts";
import { subjectRootOf, subjectRootProps } from "./subject.ts";
import { viewKey } from "./view-key.ts";

/** The outline plugin's namespace and view keys: what a host imports, never the components. */
export const OUTLINE_NAMESPACE = "outline";

/** What every frame view says of the node it is shown for. */
export const FRAME_HOST =
  " Shown for a frame (the node it is named by): lays out that frame's children.";

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

export const OutlineView = viewKey(`${OUTLINE_NAMESPACE}.main`, "Outline", OutlineParams, {
  read: (props, host) => {
    const root = subjectRootOf(props, host);
    return root === undefined ? {} : { root };
  },
  write: ({ root }) => (root === undefined ? {} : subjectRootProps(root)),
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
export const OutlineSnippetView = viewKey(
  `${OUTLINE_NAMESPACE}.snippet`,
  "Outline snippet",
  OutlineSnippetParams,
  {
    read: (props, host) => ({
      root: subjectRootOf(props, host),
      depth: 1,
      maxRows: 6,
    }),
    write: ({ root }) => subjectRootProps(root),
  },
);

/**
 * A frame view's key: a view of the frame family whose settings are the
 * frame's view node props, laying the frame's rows out as `rows` says, and
 * paging into the outline at its frame. `id` is frozen data: the frame views
 * of every family keep the `outline.` ids they were first stored under.
 */
export function frameViewKey<P extends FrameViewParams>(
  id: `${string}.${string}`,
  label: string,
  params: Schema.Decoder<P>,
  rows: FrameViewKey["rows"],
): FrameViewKey<P> {
  // A frame view's settings are the `sys.f.view.*` props that configure it.
  return {
    ...viewKey<P>(id, label, params, {
      read: (props, _host, report) => decodeFrameConfig(props, report),
      write: encodeFrameConfig,
    }),
    family: FRAME_VIEW_FAMILY,
    rows,
    // A frame view lays the frame's rows out inside the outline, so its page is
    // the outline at the frame. The outline lays the frame out through the
    // frame's own first frame view, so another of its frame view nodes chosen
    // to open it shows that one instead. GAP [[01M411FPKHWPRFTWDYKVXBDYSB]]
    page: ({ host }) => (host === null ? null : { key: OutlineView, input: { root: host } }),
  };
}

/** A frame's children as the outline shows them, nested. */
export const OutlineListView = frameViewKey(
  `${OUTLINE_NAMESPACE}.list`,
  "List",
  Schema.Struct({ filters: FRAME_SETTINGS.filters }).annotate({
    description: "A frame's children as the outline shows them, nested, filtered." + FRAME_HOST,
  }),
  "outline",
);
