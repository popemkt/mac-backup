// The hint bridge protocol: how a page asks a frame it cannot reach into
// (cross-origin, or sandboxed without allow-same-origin) for its hint targets,
// and how it activates one. Both sides decode what they receive with these
// schemas and drop anything else; neither trusts the other's data. The
// protocol is documented for embedders in core/README.md.
import { type Option, Schema } from "effect";
import { TargetKind } from "./targets.ts";

/** Every bbim bridge message carries this marker and version. */
export const BRIDGE_PROTOCOL = "bbim-bridge/1";

/** The most targets one frame may report; the rest are ignored. */
export const MAX_FRAME_TARGETS = 2000;

/** While hint mode is up the parent repeats `mode {active: true}` this often... */
export const MODE_HEARTBEAT_MS = 1000;
/** ...and a frame that hears none for this long stops forwarding keys on its own. */
export const MODE_TTL_MS = 3000;

/** The most messages a parent reads from one frame per hint session; the rest are dropped unread. */
export const FRAME_MESSAGE_BUDGET = 256;

const Marker = Schema.Literal(BRIDGE_PROTOCOL);
const RequestId = Schema.String.check(Schema.isMaxLength(64));
/** A coordinate in CSS pixels: finite and inside any plausible viewport. */
const Coordinate = Schema.Finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 }));
const Size = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }));
const ShortString = Schema.String.check(Schema.isMaxLength(64));

// Parent -> frame.

export const CollectRequest = Schema.Struct({
  bbim: Marker,
  type: Schema.Literal("collect"),
  requestId: RequestId,
});

export const ActivateRequest = Schema.Struct({
  bbim: Marker,
  type: Schema.Literal("activate"),
  requestId: RequestId,
  targetId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  newTab: Schema.Boolean,
});

/**
 * While `active`, the frame forwards every keydown to the parent and swallows
 * it. The parent sends it only to the frame that has focus, and repeats it
 * every MODE_HEARTBEAT_MS; the frame gives up after MODE_TTL_MS of silence.
 */
export const ModeRequest = Schema.Struct({
  bbim: Marker,
  type: Schema.Literal("mode"),
  active: Schema.Boolean,
});

export const ParentMessage = Schema.Union([CollectRequest, ActivateRequest, ModeRequest]);
export type ParentMessage = typeof ParentMessage.Type;

// Frame -> parent.

/** A target box in the frame's own viewport coordinates. */
export const FrameTarget = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  kind: TargetKind,
  left: Coordinate,
  top: Coordinate,
  width: Size,
  height: Size,
});
export type FrameTarget = typeof FrameTarget.Type;

export const TargetsReply = Schema.Struct({
  bbim: Marker,
  type: Schema.Literal("targets"),
  requestId: RequestId,
  targets: Schema.Array(FrameTarget).check(Schema.isMaxLength(MAX_FRAME_TARGETS)),
});

/** A keydown inside the frame while the parent's hint mode is up. */
export const KeyForward = Schema.Struct({
  bbim: Marker,
  type: Schema.Literal("key"),
  key: ShortString,
  code: ShortString,
  ctrlKey: Schema.Boolean,
  altKey: Schema.Boolean,
  metaKey: Schema.Boolean,
  shiftKey: Schema.Boolean,
  /** Held-key repeats and IME composition: forwarded so the parent can drop them too. */
  repeat: Schema.Boolean,
  isComposing: Schema.Boolean,
});

/**
 * The frame stopped forwarding on its own: a click landed inside it, or the
 * parent's renewals lapsed. The parent ends its hint session, so labels on
 * screen and where keys go never disagree.
 */
export const LeaveNotice = Schema.Struct({
  bbim: Marker,
  type: Schema.Literal("leave"),
  reason: Schema.Literals(["pointer", "lapsed"]),
});

/**
 * The frame asks the parent to open a link in a new tab (a sandboxed frame
 * usually cannot). Only as the answer to the parent's `activate` with
 * `newTab`, carrying its requestId; the parent opens only http(s) URLs.
 */
export const OpenRequest = Schema.Struct({
  bbim: Marker,
  type: Schema.Literal("open"),
  requestId: RequestId,
  url: Schema.String.check(Schema.isMaxLength(8192)),
});

export const FrameMessage = Schema.Union([TargetsReply, KeyForward, OpenRequest, LeaveNotice]);
export type FrameMessage = typeof FrameMessage.Type;

export const decodeParentMessage: (data: unknown) => Option.Option<ParentMessage> =
  Schema.decodeUnknownOption(ParentMessage);
export const decodeFrameMessage: (data: unknown) => Option.Option<FrameMessage> =
  Schema.decodeUnknownOption(FrameMessage);

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
