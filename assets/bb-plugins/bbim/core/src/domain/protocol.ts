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

/** While `active`, the frame forwards every keydown to the parent and swallows it. */
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
});

/**
 * The frame asks the parent to open a link in a new tab (a sandboxed frame
 * usually cannot). The parent opens only http(s) URLs.
 */
export const OpenRequest = Schema.Struct({
  bbim: Marker,
  type: Schema.Literal("open"),
  url: Schema.String.check(Schema.isMaxLength(8192)),
});

export const FrameMessage = Schema.Union([TargetsReply, KeyForward, OpenRequest]);
export type FrameMessage = typeof FrameMessage.Type;

export const decodeParentMessage: (data: unknown) => Option.Option<ParentMessage> =
  Schema.decodeUnknownOption(ParentMessage);
export const decodeFrameMessage: (data: unknown) => Option.Option<FrameMessage> =
  Schema.decodeUnknownOption(FrameMessage);

/** Whether a URL a frame asked to open is one a parent may open: http(s) only. */
export function isOpenableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
