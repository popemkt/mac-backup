// The parent side of the hint bridge (protocol: ../domain/protocol.ts). Every
// message is decoded with the protocol's decoders and accepted only from the
// frame concerned, within a per-frame budget; anything else is dropped unread.
//
// A remote frame is anything that speaks the protocol over a channel of its
// own: an iframe the page cannot script (postMessage), or a page a host shows
// in a native view and reaches by script (a desktop browser tab). Both are
// one RemoteFrame; nothing here knows which.
//
// Limit: a frame reports its own target boxes, and the parent can only clip
// them to the frame's box. A bridge frame could therefore place a label over
// any spot inside its own box, mislabeling what it draws there. That is
// inherent to asking a frame the parent cannot read; it is why the bridge
// script must name the parent origins it serves, and why a page should embed
// only bridge frames it trusts.
import { Effect, type Option, type Scope } from "effect";
import {
  BRIDGE_PROTOCOL,
  decodeFrameMessage,
  FRAME_MESSAGE_BUDGET,
  type FrameMessage,
  isBridgeMessage,
  isOpenableUrl,
  type ParentMessage,
} from "../domain/protocol.ts";
import type { KeyEventLike } from "../domain/keys.ts";
import { intersect, type Rect, type TargetKind } from "../domain/targets.ts";
import type { OpaqueFrame } from "./frames.ts";

/** Something that answers the bridge protocol, placed in top-level coordinates. */
export interface RemoteFrame {
  /** The element it shows in: an iframe, or the box a native page view covers. */
  readonly element: Element;
  /** Its box in top-level coordinates, clipped to what is on screen. */
  readonly box: Rect;
  /** Offset of its viewport origin in top-level coordinates. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Send it a request. */
  readonly post: (message: ParentMessage) => void;
  /** Hear what it sends (raw, undecoded); returns the function that stops. */
  readonly listen: (handler: (data: unknown) => void) => () => void;
}

/** An opaque iframe as a remote frame: postMessage to it, its own messages from its host window. */
export function iframeRemote(frame: OpaqueFrame): RemoteFrame {
  return {
    element: frame.element,
    box: frame.box,
    offsetX: frame.offsetX,
    offsetY: frame.offsetY,
    // An opaque frame's origin is "null" or unknown, so "*" is the only target
    // that reaches it. Requests carry no data worth hiding: ids and a flag.
    post: (message) => frame.element.contentWindow?.postMessage(message, "*"),
    listen: (handler) => {
      const onMessage = (event: MessageEvent) => {
        if (event.source !== null && event.source === frame.element.contentWindow) handler(event.data);
      };
      frame.host.addEventListener("message", onMessage);
      return () => frame.host.removeEventListener("message", onMessage);
    },
  };
}

export interface RemoteTarget {
  readonly frame: RemoteFrame;
  readonly id: number;
  readonly kind: TargetKind;
  /** In top-level coordinates, clipped to the frame's box. */
  readonly rect: Rect;
  /** The frame reports it transparent until hovered. */
  readonly faded: boolean;
}

/**
 * How many more bridge messages a frame may send before the rest are dropped
 * unread. A hint session keeps one for collection and one for keys, so a
 * frame typing many keys never starves its own target reply, or the reverse.
 */
export type FrameBudget = (frame: RemoteFrame) => boolean;

export function frameBudget(limit = FRAME_MESSAGE_BUDGET): FrameBudget {
  const spent = new Map<RemoteFrame, number>();
  return (frame) => {
    const used = spent.get(frame) ?? 0;
    if (used >= limit) return false;
    spent.set(frame, used + 1);
    return true;
  };
}

/**
 * Decode a message of one of `types` from `frame`. Only bridge messages of
 * those types are charged to this listener's budget (other traffic, and
 * messages another listener reads, are not), and only within budget are they
 * decoded at all.
 */
function receive(
  frame: RemoteFrame,
  budget: FrameBudget,
  data: unknown,
  types: ReadonlyArray<FrameMessage["type"]>,
): FrameMessage | undefined {
  if (!isBridgeMessage(data, types) || !budget(frame)) return undefined;
  return decodeFrameMessage(data);
}

function placed(frame: RemoteFrame, message: Extract<FrameMessage, { type: "targets" }>): Array<RemoteTarget> {
  // Frame-supplied boxes: trusted only as far as the frame's own box (see the limit above).
  return message.targets.flatMap((target) => {
    const rect = intersect(
      { left: target.left + frame.offsetX, top: target.top + frame.offsetY, width: target.width, height: target.height },
      frame.box,
    );
    return rect === undefined ? [] : [{ frame, id: target.id, kind: target.kind, rect, faded: target.faded === true }];
  });
}

/** Listen to every one of `frames`; the returned function stops them all. */
function listenAll(frames: ReadonlyArray<RemoteFrame>, handler: (frame: RemoteFrame, data: unknown) => void): () => void {
  const stops = frames.map((frame) => frame.listen((data) => handler(frame, data)));
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const stop of stops) stop();
  };
}

const NOTHING = () => {};

/**
 * Listen to `frames` until `onMessage` calls `done` or `timeoutMs` passes,
 * then stop listening, whichever way it ends: `Effect.callback`'s own cleanup
 * runs only on interruption, so the success path stops explicitly. `start`
 * runs once the listener is in place (to send the request).
 */
function untilAnswered<A>(
  frames: ReadonlyArray<RemoteFrame>,
  timeoutMs: number,
  onMessage: (frame: RemoteFrame, data: unknown, done: (value: A) => void) => void,
  start: () => void = NOTHING,
): Effect.Effect<Option.Option<A>> {
  return Effect.suspend(() => {
    let stop = NOTHING;
    const answered = Effect.callback<A>((resume) => {
      stop = listenAll(frames, (frame, data) => onMessage(frame, data, (value) => resume(Effect.succeed(value))));
      start();
      return Effect.sync(() => stop());
    });
    return Effect.ensuring(Effect.timeoutOption(answered, timeoutMs), Effect.sync(() => stop()));
  });
}

/**
 * Ask every remote frame for its targets and wait up to `timeoutMs` for the
 * replies. A frame without the bridge never answers and contributes nothing.
 * `onReply` sees every target so far each time a frame answers, so a caller
 * can show them before the slowest frame is in.
 */
export const collectRemote = Effect.fn("collectRemote")(function* (
  frames: ReadonlyArray<RemoteFrame>,
  requestId: string,
  timeoutMs: number,
  budget: FrameBudget = frameBudget(),
  onReply: (sofar: ReadonlyArray<RemoteTarget>) => void = NOTHING,
) {
  if (frames.length === 0) return [] as ReadonlyArray<RemoteTarget>;
  const replies = new Map<RemoteFrame, ReadonlyArray<RemoteTarget>>();
  yield* untilAnswered<void>(
    frames,
    timeoutMs,
    (frame, data, done) => {
      if (replies.has(frame)) return;
      const message = receive(frame, budget, data, ["targets"]);
      if (message?.type !== "targets" || message.requestId !== requestId) return;
      replies.set(frame, placed(frame, message));
      if (replies.size === frames.length) done(undefined);
      else onReply(frames.flatMap((each) => replies.get(each) ?? []));
    },
    () => {
      for (const frame of frames) frame.post({ bbim: BRIDGE_PROTOCOL, type: "collect", requestId });
    },
  );
  return frames.flatMap((frame) => replies.get(frame) ?? []);
});

export function activateRemote(target: RemoteTarget, requestId: string, newTab: boolean): void {
  target.frame.post({ bbim: BRIDGE_PROTOCOL, type: "activate", requestId, targetId: target.id, newTab });
}

/**
 * The frame's answer to an `activate` with `newTab`: the one http(s) URL it
 * asks to have opened, carrying that activation's requestId, within
 * `timeoutMs`. Any other open request, before or after, is ignored.
 */
export const awaitOpen = Effect.fn("awaitOpen")(function* (frame: RemoteFrame, requestId: string, timeoutMs: number) {
  const budget = frameBudget();
  return yield* untilAnswered<string>([frame], timeoutMs, (from, data, done) => {
    const message = receive(from, budget, data, ["open"]);
    if (message?.type !== "open" || message.requestId !== requestId || !isOpenableUrl(message.url)) return;
    done(message.url);
  });
});

/** Turn key forwarding on or off in the one frame that has focus. */
export function setRemoteMode(frame: RemoteFrame, active: boolean): void {
  frame.post({ bbim: BRIDGE_PROTOCOL, type: "mode", active });
}

export interface ForwardHandlers {
  /** A keydown typed in the frame (never a held-key repeat or IME composition). */
  readonly onKey: (event: KeyEventLike) => void;
  /** The frame stopped forwarding on its own (a click in it, or lapsed renewals). */
  readonly onLeave: () => void;
}

/**
 * What `frame` sends while it forwards keys, for as long as the scope lives.
 * Only that frame is heard, within its own budget.
 */
export const listenForwarded = Effect.fn("listenForwarded")(function* (
  frame: RemoteFrame,
  handlers: ForwardHandlers,
  budget: FrameBudget = frameBudget(),
): Effect.fn.Return<void, never, Scope.Scope> {
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      frame.listen((data) => {
        const message = receive(frame, budget, data, ["key", "leave"]);
        if (message?.type === "key" && !message.repeat && !message.isComposing) handlers.onKey(message);
        else if (message?.type === "leave") handlers.onLeave();
      }),
    ),
    (stop) => Effect.sync(stop),
  );
});
