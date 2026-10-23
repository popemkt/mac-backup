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
 * How many more messages each frame may send before the rest are dropped
 * unread. One per hint session, shared by everything that reads frames.
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

/** Decode a message from one of `frames`, if it comes from one and its budget allows. */
function receive(
  frames: ReadonlyArray<OpaqueFrame>,
  budget: FrameBudget,
  event: MessageEvent,
): { readonly frame: OpaqueFrame; readonly message: FrameMessage } | undefined {
  const frame = frameOf(frames, event.source);
  if (frame === undefined || !budget(frame)) return undefined;
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
  return () => {
    for (const host of hosts) host.removeEventListener("message", handler);
  };
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
  const gathered = Effect.callback<void>((resume) => {
    const stop = onHostMessages(frames, (event) => {
      const received = receive(frames, budget, event);
      if (received === undefined || replies.has(received.frame)) return;
      const { frame, message } = received;
      if (message.type !== "targets" || message.requestId !== requestId) return;
      replies.set(frame, placed(frame, message));
      if (replies.size === frames.length) resume(Effect.void);
    });
    for (const frame of frames) post(frame, { bbim: BRIDGE_PROTOCOL, type: "collect", requestId });
    return Effect.sync(stop);
  });
  yield* Effect.timeoutOption(gathered, timeoutMs);
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
  const opened = Effect.callback<string>((resume) => {
    const stop = onHostMessages([frame], (event) => {
      const received = receive([frame], budget, event);
      if (received === undefined) return;
      const { message } = received;
      if (message.type !== "open" || message.requestId !== requestId || !isOpenableUrl(message.url)) return;
      resume(Effect.succeed(message.url));
    });
    return Effect.sync(stop);
  });
  return yield* Effect.timeoutOption(opened, timeoutMs);
});

/** Turn key forwarding on or off in the one frame that has focus. */
export function setRemoteMode(frame: OpaqueFrame, active: boolean): void {
  post(frame, { bbim: BRIDGE_PROTOCOL, type: "mode", active });
}

/**
 * Keys the focused frame forwards while hint mode is up, for as long as the
 * scope lives. Only that frame is heard, within the session's budget.
 */
export const listenForwarded = Effect.fn("listenForwarded")(function* (
  frame: OpaqueFrame,
  onKey: (event: KeyEventLike) => void,
  budget: FrameBudget = frameBudget(),
): Effect.fn.Return<void, never, Scope.Scope> {
  yield* listen<MessageEvent>(frame.host, "message", (event) => {
    const received = receive([frame], budget, event);
    if (received?.message.type === "key") onKey(received.message);
  });
});
