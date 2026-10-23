// The parent side of the hint bridge (protocol: ../domain/protocol.ts). Every
// reply is decoded with the protocol's schemas and accepted only from the
// window of the frame it was asked of; anything else is dropped unread.
import { Effect, Option, type Scope } from "effect";
import {
  BRIDGE_PROTOCOL,
  decodeFrameMessage,
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

function placed(frame: OpaqueFrame, message: Extract<FrameMessage, { type: "targets" }>): Array<RemoteTarget> {
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

/**
 * Ask every opaque frame for its targets and wait up to `timeoutMs` for the
 * replies. A frame without the bridge never answers and contributes nothing.
 */
export const collectRemote = Effect.fn("collectRemote")(function* (
  frames: ReadonlyArray<OpaqueFrame>,
  requestId: string,
  timeoutMs: number,
) {
  if (frames.length === 0) return [] as ReadonlyArray<RemoteTarget>;
  const replies = new Map<OpaqueFrame, ReadonlyArray<RemoteTarget>>();
  const gathered = Effect.callback<void>((resume) => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameOf(frames, event.source);
      if (frame === undefined || replies.has(frame)) return;
      const message = decodeFrameMessage(event.data);
      if (Option.isNone(message) || message.value.type !== "targets" || message.value.requestId !== requestId) return;
      replies.set(frame, placed(frame, message.value));
      if (replies.size === frames.length) resume(Effect.void);
    };
    const hosts = hostsOf(frames);
    for (const host of hosts) host.addEventListener("message", onMessage);
    for (const frame of frames) post(frame, { bbim: BRIDGE_PROTOCOL, type: "collect", requestId });
    return Effect.sync(() => {
      for (const host of hosts) host.removeEventListener("message", onMessage);
    });
  });
  yield* Effect.timeoutOption(gathered, timeoutMs);
  return frames.flatMap((frame) => replies.get(frame) ?? []);
});

export function activateRemote(target: RemoteTarget, requestId: string, newTab: boolean): void {
  post(target.frame, { bbim: BRIDGE_PROTOCOL, type: "activate", requestId, targetId: target.id, newTab });
}

export function setRemoteMode(frames: ReadonlyArray<OpaqueFrame>, active: boolean): void {
  for (const frame of frames) post(frame, { bbim: BRIDGE_PROTOCOL, type: "mode", active });
}

export interface ForwardHandlers {
  /** A keydown the frame forwarded while hint mode is up. */
  readonly onKey: (event: KeyEventLike) => void;
  /** A frame asked for an http(s) URL to be opened in a new tab. */
  readonly onOpen: (url: string) => void;
}

/** Listen for keys and open requests from these frames for as long as the scope lives. */
export const listenForwarded = Effect.fn("listenForwarded")(function* (
  frames: ReadonlyArray<OpaqueFrame>,
  handlers: ForwardHandlers,
): Effect.fn.Return<void, never, Scope.Scope> {
  for (const host of hostsOf(frames)) {
    yield* listen<MessageEvent>(host, "message", (event) => {
      if (frameOf(frames, event.source) === undefined) return;
      const message = decodeFrameMessage(event.data);
      if (Option.isNone(message)) return;
      if (message.value.type === "key") handlers.onKey(message.value);
      else if (message.value.type === "open" && isOpenableUrl(message.value.url)) handlers.onOpen(message.value.url);
    });
  }
});
