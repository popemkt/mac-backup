// The hint bridge protocol: how a page asks a frame it cannot reach into
// (cross-origin, or sandboxed without allow-same-origin) for its hint targets,
// and how it activates one. Both sides decode what they receive with the
// decoders here and drop anything else; neither trusts the other's data. The
// protocol is documented for embedders in core/README.md.
//
// Plain TypeScript on purpose, with no Effect import: a frame bundles this
// file, and Schema alone would cost it over 200 KB. Each message is written
// once, as a spec of field checks; its type is derived from that spec, so the
// checks and the types cannot drift apart.
import { SCROLL_ACTIONS } from "./scroll.ts";
import { TARGET_KINDS } from "./targets.ts";

/** Every bbim bridge message carries this marker and version. */
export const BRIDGE_PROTOCOL = "bbim-bridge/1";

/** The most targets one frame may report; a reply with more is refused. */
export const MAX_FRAME_TARGETS = 2000;

/** While hint mode is up the parent repeats `mode {active: true}` this often... */
export const MODE_HEARTBEAT_MS = 1000;
/** ...and a frame that hears none for this long stops forwarding keys on its own. */
export const MODE_TTL_MS = 3000;

/** The most messages a parent reads from one frame per hint session and listener; the rest are dropped unread. */
export const FRAME_MESSAGE_BUDGET = 256;

// ---- field checks ----------------------------------------------------------

/** A check that narrows an untrusted value to `A`. */
type Check<A> = (value: unknown) => value is A;
type Checked<C> = C extends Check<infer A> ? A : never;
type Shape = Readonly<Record<string, Check<unknown>>>;
type Of<S extends Shape> = { readonly [K in keyof S]: Checked<S[K]> };
type Maybe<O extends Shape> = { readonly [K in keyof O]?: Checked<O[K]> };
const NONE: Readonly<Record<never, Check<unknown>>> = {};

const text =
  (max: number): Check<string> =>
  (value): value is string =>
    typeof value === "string" && value.length <= max;

const flag: Check<boolean> = (value): value is boolean => typeof value === "boolean";

/** A finite number in [min, max]; `integer` also requires a whole one. */
const number =
  (min: number, max: number, integer = false): Check<number> =>
  (value): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value));

const oneOf =
  <const L extends string>(values: ReadonlyArray<L>): Check<L> =>
  (value): value is L =>
    values.some((allowed) => allowed === value);

const listOf =
  <A>(item: Check<A>, max: number): Check<ReadonlyArray<A>> =>
  (value): value is ReadonlyArray<A> =>
    Array.isArray(value) && value.length <= max && value.every(item);

/**
 * Every key of `shape` and any of `optional`, each passing its check: no
 * missing required key and no key outside the two.
 */
const struct =
  <S extends Shape, O extends Shape = typeof NONE>(shape: S, optional: O = NONE as O): Check<Of<S> & Maybe<O>> =>
  (value): value is Of<S> & Maybe<O> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Readonly<Record<string, unknown>>;
    if (!Object.keys(shape).every((key) => Object.hasOwn(record, key))) return false;
    return Object.keys(record).every((key) => {
      const check = Object.hasOwn(shape, key) ? shape[key] : Object.hasOwn(optional, key) ? optional[key] : undefined;
      return check?.(record[key]) === true;
    });
  };

/** A bridge message: the marker, its `type`, and its own fields. */
const message = <const T extends string, S extends Shape>(type: T, fields: S) =>
  struct({ bbim: oneOf([BRIDGE_PROTOCOL]), type: oneOf([type]), ...fields });

const requestId = text(64);
/** A coordinate in CSS pixels: finite and inside any plausible viewport. */
const coordinate = number(-100_000, 100_000);
const size = number(0, 100_000);
const id = number(0, Number.MAX_SAFE_INTEGER, true);

/**
 * What a pick session labels, and so what a frame reports and what picking
 * one of its targets does there: `hints` every clickable thing (activating
 * follows, clicks or focuses it), `inputs` the text inputs `gi` offers
 * (focusing one), `scroll` the surfaces `gs` offers (picking one makes it
 * what the parent's scroll keys move in that frame).
 */
export const PICKERS = ["hints", "inputs", "scroll"] as const;
export type PickerName = (typeof PICKERS)[number];

// ---- parent -> frame -------------------------------------------------------

const parentMessages = {
  /** Report the targets of `picker`; absent means `hints`, so a frame from before pickers still answers hints. */
  collect: struct({ bbim: oneOf([BRIDGE_PROTOCOL]), type: oneOf(["collect"]), requestId }, { picker: oneOf(PICKERS) }),
  /** Activate a target of the last collect, as its picker does. */
  activate: message("activate", { requestId, targetId: id, newTab: flag }),
  /**
   * Scroll the surface the person picked in this frame (a `scroll` collect,
   * then its activation) by one scroll key's `action`; `step` is the
   * parent's scroll step in CSS px, `repeat` a held key. Sent only to the
   * frame whose surface was picked; with none picked the frame does nothing.
   */
  scroll: message("scroll", { action: oneOf(SCROLL_ACTIONS), step: number(1, 100_000), repeat: flag }),
  /**
   * While `active`, the frame forwards every keydown to the parent and
   * swallows it. The parent sends it only to the frame that has focus, and
   * repeats it every MODE_HEARTBEAT_MS; the frame gives up after MODE_TTL_MS
   * of silence.
   */
  mode: struct(
    { bbim: oneOf([BRIDGE_PROTOCOL]), type: oneOf(["mode"]), active: flag, requestId },
    /**
     * Native pages only: the document (its `ready` nonce) the session's keys
     * came from. A page whose document differs (it navigated) refuses to
     * forward, so a new document never swallows keys for a stale session.
     */
    { document: text(64) },
  ),
  /**
   * Native pages only (a page a host shows in a native view over its own
   * window, which covers the parent's overlay): draw these labels on the
   * targets of the last `collect`, by id. An empty list removes them. A
   * postMessage bridge ignores it: the parent draws over an iframe itself.
   */
  labels: message("labels", { labels: listOf(struct({ id, label: text(16) }), MAX_FRAME_TARGETS) }),
  /** Native pages only: narrow the drawn labels to those starting with `typed`. */
  typed: message("typed", { typed: text(16) }),
  /**
   * Chords the parent binds (its host's commands). Keys typed in a frame or
   * a native page never reach the parent, so the bridge passes these back as
   * `key` messages, matched by physical `code` and modifiers, unless the page
   * handled the key itself (its own bindings win). The parent sends them to
   * a native page it attached and to the iframe focus is in; `[]` clears them.
   */
  chords: message("chords", {
    chords: listOf(struct({ code: text(32), ctrlKey: flag, altKey: flag, metaKey: flag, shiftKey: flag }), 32),
  }),
};

// ---- frame -> parent -------------------------------------------------------

/**
 * A target box in the frame's own viewport coordinates; `faded` when it shows
 * only on hover. `kind` (what activating it does) only for a hint target.
 */
const frameTarget = struct(
  { id, left: coordinate, top: coordinate, width: size, height: size },
  { kind: oneOf(TARGET_KINDS), faded: flag },
);
export type FrameTarget = Checked<typeof frameTarget>;

const frameMessages = {
  targets: message("targets", { requestId, targets: listOf(frameTarget, MAX_FRAME_TARGETS) }),
  /**
   * A keydown inside the frame while the parent's hint mode is up, or one of
   * the parent's `chords` typed there. `repeat` and `isComposing`
   * travel so the parent can drop held and IME keys too.
   */
  key: message("key", {
    key: text(64),
    code: text(64),
    ctrlKey: flag,
    altKey: flag,
    metaKey: flag,
    shiftKey: flag,
    repeat: flag,
    isComposing: flag,
  }),
  /**
   * The frame asks the parent to open a link in a new tab (a sandboxed frame
   * usually cannot). Only as the answer to the parent's `activate` with
   * `newTab`, carrying its requestId; the parent opens only http(s) URLs.
   */
  open: message("open", { requestId, url: text(8192) }),
  /**
   * The frame stopped forwarding on its own: a click landed inside it, or the
   * parent's renewals lapsed. The parent ends its hint session, so labels on
   * screen and where keys go never disagree.
   */
  leave: message("leave", { reason: oneOf(["pointer", "lapsed"]) }),
  /**
   * Native pages only: the page bridge's document, named by a nonce fresh in
   * each document. Sent when it installs and in answer to every `chords`. A
   * document the parent has not seen ends a hint session the page was part
   * of (its labels and targets went with the old document); `mode` names the
   * document it is for.
   */
  ready: message("ready", { document: text(64) }),
};

type Messages<M extends Readonly<Record<string, Check<unknown>>>> = { [K in keyof M]: Checked<M[K]> }[keyof M];
export type ParentMessage = Messages<typeof parentMessages>;
export type FrameMessage = Messages<typeof frameMessages>;

/** Decode by `type`, so each message is checked against its own spec only. */
const decoder =
  <M extends Readonly<Record<string, Check<unknown>>>>(specs: M) =>
  (data: unknown): Messages<M> | undefined => {
    if (typeof data !== "object" || data === null || !("type" in data) || typeof data.type !== "string") return undefined;
    if (!Object.hasOwn(specs, data.type)) return undefined;
    const check = specs[data.type];
    return check?.(data) === true ? (data as Messages<M>) : undefined;
  };

/** A parent message, or undefined for anything that is not exactly one. */
export const decodeParentMessage: (data: unknown) => ParentMessage | undefined = decoder(parentMessages);
/** A frame message, or undefined for anything that is not exactly one. */
export const decodeFrameMessage: (data: unknown) => FrameMessage | undefined = decoder(frameMessages);

/**
 * Whether `data` claims to be a bridge message of one of `types`: the cheap
 * look before a listener charges a frame's budget and decodes it.
 */
export function isBridgeMessage(data: unknown, types: ReadonlyArray<FrameMessage["type"]>): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "bbim" in data &&
    data.bbim === BRIDGE_PROTOCOL &&
    "type" in data &&
    types.some((type) => type === data.type)
  );
}

/** Whether a URL a frame asked to open is one a parent may open: http(s) only. */
export function isOpenableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
