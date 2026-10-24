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
  type PickerName,
} from "../domain/protocol.ts";
import type { KeyEventLike } from "../domain/keys.ts";
import type { ScrollAction } from "../domain/scroll.ts";
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
  /**
   * A page in a native view over this window: it covers the overlay, so it
   * draws its own labels (sent `labels` and `typed`); and its bridge is the
   * host's own script forwarding only keys a person typed, so those keys may
   * pick any label, not just its own.
   */
  readonly native: boolean;
  /** A native page's document, as its bridge last announced it (`ready`); `mode` names it. */
  readonly document?: string;
}

/**
 * A page a host shows in a native view over `element` and reaches by script
 * (bb's desktop Browser tab). `send` delivers a request to its page bridge;
 * `listen` hears what that bridge posts back.
 */
export interface PageView {
  readonly element: Element;
  readonly send: (message: ParentMessage) => void;
  readonly listen: (handler: (data: unknown) => void) => () => void;
}

/**
 * A page view as a remote frame where its element is now; undefined while it
 * shows nothing. `document` reads the page's document as the bridge last
 * announced it, at each `mode` (it may be learned mid-session).
 */
export function pageRemote(view: PageView, document: () => string | undefined = () => undefined): RemoteFrame | undefined {
  if (!view.element.isConnected) return undefined;
  const win = view.element.ownerDocument.defaultView;
  const box = view.element.getBoundingClientRect();
  const screen = { left: 0, top: 0, width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 };
  const shown = intersect({ left: box.left, top: box.top, width: box.width, height: box.height }, screen);
  if (shown === undefined) return undefined;
  return {
    element: view.element,
    box: shown,
    offsetX: box.left,
    offsetY: box.top,
    post: view.send,
    listen: view.listen,
    native: true,
    get document() {
      return document();
    },
  };
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
    native: false,
  };
}

export interface RemoteTarget {
  readonly frame: RemoteFrame;
  readonly id: number;
  /** What activating it does, for a hint target; undefined for the other pickers'. */
  readonly kind: TargetKind | undefined;
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
 * Ask every remote frame for its targets of `picker` and wait up to
 * `timeoutMs` for the replies. A frame without the bridge never answers and
 * contributes nothing. `onReply` sees every target so far each time a frame
 * answers, so a caller can show them before the slowest frame is in.
 */
export const collectRemote = Effect.fn("collectRemote")(function* (
  frames: ReadonlyArray<RemoteFrame>,
  requestId: string,
  timeoutMs: number,
  budget: FrameBudget = frameBudget(),
  onReply: (sofar: ReadonlyArray<RemoteTarget>) => void = NOTHING,
  picker: PickerName = "hints",
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
      // `hints` goes unnamed, so a frame from before pickers still answers it.
      const request: ParentMessage =
        picker === "hints"
          ? { bbim: BRIDGE_PROTOCOL, type: "collect", requestId }
          : { bbim: BRIDGE_PROTOCOL, type: "collect", requestId, picker };
      for (const frame of frames) frame.post(request);
    },
  );
  return frames.flatMap((frame) => replies.get(frame) ?? []);
});

export function activateRemote(target: RemoteTarget, requestId: string, newTab: boolean): void {
  target.frame.post({ bbim: BRIDGE_PROTOCOL, type: "activate", requestId, targetId: target.id, newTab });
}

/** Scroll the surface picked in `frame` (a `scroll` target of it, activated) by one scroll key. */
export function scrollRemote(frame: RemoteFrame, action: ScrollAction, step: number, repeat: boolean): void {
  frame.post({ bbim: BRIDGE_PROTOCOL, type: "scroll", action, step, repeat });
}

/** A host chord as a bridge matches it: by physical key and modifiers. */
export type ChordCode = Extract<ParentMessage, { readonly type: "chords" }>["chords"][number];

/** Tell `frame` the host's chords, which it passes back when typed in it; `[]` clears them. */
export function sendChords(frame: Pick<RemoteFrame, "post">, chords: ReadonlyArray<ChordCode>): void {
  frame.post({ bbim: BRIDGE_PROTOCOL, type: "chords", chords: [...chords] });
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

/**
 * Turn key forwarding on or off in the one frame that has focus, for the
 * session `requestId` (a frame ignores a late `on` for a session it was told
 * is over). A native page also gets the document the session belongs to.
 */
export function setRemoteMode(frame: RemoteFrame, active: boolean, requestId: string): void {
  frame.post({
    bbim: BRIDGE_PROTOCOL,
    type: "mode",
    active,
    requestId,
    ...(frame.document === undefined ? {} : { document: frame.document }),
  });
}

export interface ForwardHandlers {
  /** A keydown typed in the frame (never a held-key repeat or IME composition). */
  readonly onKey: (event: KeyEventLike) => void;
  /**
   * The frame stopped forwarding on its own (a click in it, or lapsed
   * renewals), or sent more keys than the budget allows: either way the
   * session ends, so a key is never dropped while the frame keeps swallowing.
   */
  readonly onLeave: () => void;
}

/** Whether `data` is a message that ends hints (Esc, `leave`): never refused for budget. */
function endsHints(data: unknown): boolean {
  return (
    isBridgeMessage(data, ["leave"]) ||
    (isBridgeMessage(data, ["key"]) && typeof data === "object" && data !== null && "key" in data && data.key === "Escape")
  );
}

/**
 * What `frame` sends while it forwards keys, for as long as the scope lives.
 * Only that frame is heard, within its own budget; Esc and `leave` always
 * get through, and a frame past its budget ends the session.
 */
export const listenForwarded = Effect.fn("listenForwarded")(function* (
  frame: RemoteFrame,
  handlers: ForwardHandlers,
  budget: FrameBudget = frameBudget(),
): Effect.fn.Return<void, never, Scope.Scope> {
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      frame.listen((data) => {
        if (!isBridgeMessage(data, ["key", "leave"])) return;
        if (!endsHints(data) && !budget(frame)) {
          handlers.onLeave();
          return;
        }
        const message = decodeFrameMessage(data);
        if (message?.type === "key" && !message.repeat && !message.isComposing) handlers.onKey(message);
        else if (message?.type === "leave") handlers.onLeave();
      }),
    ),
    (stop) => Effect.sync(stop),
  );
});
