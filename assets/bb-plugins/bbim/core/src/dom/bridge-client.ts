// The parent side of the hint bridge (protocol: ../domain/protocol.ts). Every
// message is decoded with the protocol's schemas and accepted only from the
// window of the frame concerned, within a per-frame budget; anything else is
// dropped unread.
//
// Limit: a frame reports its own target boxes, and the parent can only clip
// them to the frame's box. A bridge frame could therefore place a label over
// any spot inside its own box, mislabeling what it draws there. That is
// inherent to asking a frame the parent cannot read; it is why the bridge
// script must name the parent origins it serves, and why a page should embed
// only bridge frames it trusts.
import { Effect, Option, type Scope } from "effect";
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
import { listen } from "./resources.ts";

export interface RemoteTarget {
  readonly frame: OpaqueFrame;
  readonly id: number;
  readonly kind: TargetKind;
  /** In top-level coordinates, clipped to the frame's box. */
  readonly rect: Rect;
}

function post(frame: OpaqueFrame, message: ParentMessage): void {
  // An opaque frame's origin is "null" or unknown, so "*" is the only target
  // that reaches it. Requests carry no data worth hiding: ids and a flag.
  frame.element.contentWindow?.postMessage(message, "*");
}

function frameOf(frames: ReadonlyArray<OpaqueFrame>, source: MessageEventSource | null): OpaqueFrame | undefined {
  return source === null ? undefined : frames.find((frame) => frame.element.contentWindow === source);
}

/**
 * How many more bridge messages a frame may send before the rest are dropped
 * unread. A hint session keeps one for collection and one for keys, so a
 * frame typing many keys never starves its own target reply, or the reverse.
 */
export type FrameBudget = (frame: OpaqueFrame) => boolean;

export function frameBudget(limit = FRAME_MESSAGE_BUDGET): FrameBudget {
  const spent = new Map<OpaqueFrame, number>();
  return (frame) => {
    const used = spent.get(frame) ?? 0;
    if (used >= limit) return false;
    spent.set(frame, used + 1);
    return true;
  };
}

/**
 * Decode a message of one of `types` from one of `frames`. Only bridge
 * messages of those types are charged to this listener's budget (other
 * traffic, and messages another listener reads, are not), and only within
 * budget are they decoded at all.
 */
function receive(
  frames: ReadonlyArray<OpaqueFrame>,
  budget: FrameBudget,
  event: MessageEvent,
  types: ReadonlyArray<FrameMessage["type"]>,
): { readonly frame: OpaqueFrame; readonly message: FrameMessage } | undefined {
  const frame = frameOf(frames, event.source);
  if (frame === undefined || !isBridgeMessage(event.data, types) || !budget(frame)) return undefined;
  const message = decodeFrameMessage(event.data);
  return Option.isNone(message) ? undefined : { frame, message: message.value };
}

function placed(frame: OpaqueFrame, message: Extract<FrameMessage, { type: "targets" }>): Array<RemoteTarget> {
  // Frame-supplied boxes: trusted only as far as the frame's own box (see the limit above).
  return message.targets.flatMap((target) => {
    const rect = intersect(
      { left: target.left + frame.offsetX, top: target.top + frame.offsetY, width: target.width, height: target.height },
      frame.box,
    );
    return rect === undefined ? [] : [{ frame, id: target.id, kind: target.kind, rect }];
  });
}

function hostsOf(frames: ReadonlyArray<OpaqueFrame>): ReadonlyArray<Window> {
  return [...new Set(frames.map((frame) => frame.host))];
}

/** Listen on every window that hosts one of `frames`; the returned function stops. */
function onHostMessages(frames: ReadonlyArray<OpaqueFrame>, handler: (event: MessageEvent) => void): () => void {
  const hosts = hostsOf(frames);
  for (const host of hosts) host.addEventListener("message", handler);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const host of hosts) host.removeEventListener("message", handler);
  };
}

const NOTHING = () => {};

/**
 * Listen to `frames`' messages until `onMessage` calls `done` or `timeoutMs`
 * passes, then stop listening, whichever way it ends: `Effect.callback`'s own
 * cleanup runs only on interruption, so the success path stops explicitly.
 * `start` runs once the listener is in place (to send the request).
 */
function untilAnswered<A>(
  frames: ReadonlyArray<OpaqueFrame>,
  timeoutMs: number,
  onMessage: (event: MessageEvent, done: (value: A) => void) => void,
  start: () => void = NOTHING,
): Effect.Effect<Option.Option<A>> {
  return Effect.suspend(() => {
    let stop = NOTHING;
    const answered = Effect.callback<A>((resume) => {
      stop = onHostMessages(frames, (event) => onMessage(event, (value) => resume(Effect.succeed(value))));
      start();
      return Effect.sync(() => stop());
    });
    return Effect.ensuring(Effect.timeoutOption(answered, timeoutMs), Effect.sync(() => stop()));
  });
}

/**
 * Ask every opaque frame for its targets and wait up to `timeoutMs` for the
 * replies. A frame without the bridge never answers and contributes nothing.
 */
export const collectRemote = Effect.fn("collectRemote")(function* (
  frames: ReadonlyArray<OpaqueFrame>,
  requestId: string,
  timeoutMs: number,
  budget: FrameBudget = frameBudget(),
) {
  if (frames.length === 0) return [] as ReadonlyArray<RemoteTarget>;
  const replies = new Map<OpaqueFrame, ReadonlyArray<RemoteTarget>>();
  yield* untilAnswered<void>(
    frames,
    timeoutMs,
    (event, done) => {
      const received = receive(frames, budget, event, ["targets"]);
      if (received === undefined || replies.has(received.frame)) return;
      const { frame, message } = received;
      if (message.type !== "targets" || message.requestId !== requestId) return;
      replies.set(frame, placed(frame, message));
      if (replies.size === frames.length) done(undefined);
    },
    () => {
      for (const frame of frames) post(frame, { bbim: BRIDGE_PROTOCOL, type: "collect", requestId });
    },
  );
  return frames.flatMap((frame) => replies.get(frame) ?? []);
});

export function activateRemote(target: RemoteTarget, requestId: string, newTab: boolean): void {
  post(target.frame, { bbim: BRIDGE_PROTOCOL, type: "activate", requestId, targetId: target.id, newTab });
}

/**
 * The frame's answer to an `activate` with `newTab`: the one http(s) URL it
 * asks to have opened, carrying that activation's requestId, within
 * `timeoutMs`. Any other open request, before or after, is ignored.
 */
export const awaitOpen = Effect.fn("awaitOpen")(function* (frame: OpaqueFrame, requestId: string, timeoutMs: number) {
  const budget = frameBudget();
  return yield* untilAnswered<string>([frame], timeoutMs, (event, done) => {
    const received = receive([frame], budget, event, ["open"]);
    if (received === undefined) return;
    const { message } = received;
    if (message.type !== "open" || message.requestId !== requestId || !isOpenableUrl(message.url)) return;
    done(message.url);
  });
});

/** Turn key forwarding on or off in the one frame that has focus. */
export function setRemoteMode(frame: OpaqueFrame, active: boolean): void {
  post(frame, { bbim: BRIDGE_PROTOCOL, type: "mode", active });
}

export interface ForwardHandlers {
  /** A keydown typed in the frame (never a held-key repeat or IME composition). */
  readonly onKey: (event: KeyEventLike) => void;
  /** The frame stopped forwarding on its own (a click in it, or lapsed renewals). */
  readonly onLeave: () => void;
}

/**
 * What the focused frame sends while hint mode is up, for as long as the
 * scope lives. Only that frame is heard, within its own budget.
 */
export const listenForwarded = Effect.fn("listenForwarded")(function* (
  frame: OpaqueFrame,
  handlers: ForwardHandlers,
  budget: FrameBudget = frameBudget(),
): Effect.fn.Return<void, never, Scope.Scope> {
  yield* listen<MessageEvent>(frame.host, "message", (event) => {
    const message = receive([frame], budget, event, ["key", "leave"])?.message;
    if (message?.type === "key" && !message.repeat && !message.isComposing) handlers.onKey(message);
    else if (message?.type === "leave") handlers.onLeave();
  });
});
