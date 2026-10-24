// The in-frame side of the hint bridge. Include it in a page that is shown in
// a frame its parent cannot script (cross-origin, or sandboxed without
// allow-same-origin) and the parent's hints reach into it. Protocol:
// ../domain/protocol.ts; embedding: ../../README.md.
//
// It fails closed: it installs only with an explicit list of parent origins,
// answers only `window.parent` from one of them, decodes every request with
// the protocol's decoders, and never lets an opaque ("null") origin switch on
// key forwarding or activate anything. Key forwarding also ends on its own
// when the parent stops renewing it, so a parent that dies mid-session
// cannot leave the frame swallowing keys.
//
// Plain DOM on purpose: this file and what it imports (collect, frames,
// activate, the protocol decoders) are all a frame bundles, so none of it
// imports Effect; scripts/build-bridge.mjs fails the build if any does. The
// built script is ../../bridge/bbim-bridge.js.
import {
  BRIDGE_PROTOCOL,
  decodeParentMessage,
  type FrameMessage,
  type ParentMessage,
  isOpenableUrl,
  MODE_TTL_MS,
} from "../domain/protocol.ts";
import type { TargetKind } from "../domain/targets.ts";
import { activateElement } from "../dom/activate.ts";
import { collectTargets, DEFAULT_SELECTORS } from "../dom/collect.ts";
import { frameTree } from "../dom/frames.ts";

export interface BridgeOptions {
  /** The frame's window. Defaults to the global one. */
  readonly window?: Window;
  /**
   * Parent origins to answer, e.g. `["https://app.example"]`. Required: with
   * none the bridge does not install. List `"null"` only for a sandboxed
   * parent, and then it may only ask for targets: an opaque origin can be
   * anyone, so it never turns on key forwarding or activates a control.
   */
  readonly parentOrigins: ReadonlyArray<string>;
  readonly selectors?: ReadonlyArray<string>;
  /** How long key forwarding outlives the parent's last renewal. */
  readonly modeTtlMs?: number;
}

const INSTALLED = Symbol.for("bbim.bridge.installed");
const NOTHING = () => {};

/** Where a bridge's replies go: a transport, and who asked (an origin, passed back as is). */
export type BridgeReply = (message: FrameMessage, to: string) => void;

export interface BridgeCore {
  /** Handle one decoded request from `from` (passed back to the reply). */
  readonly receive: (message: ParentMessage, from: string) => void;
  /** Stop forwarding and forget the targets. */
  readonly dispose: () => void;
}

/**
 * The bridge itself, over any transport: it collects and activates targets
 * and forwards keys while asked to. The transport decodes requests, decides
 * who may send which (installBbimBridge: origins), and carries the replies.
 */
export function bridgeCore(
  win: Window,
  options: { readonly selectors?: ReadonlyArray<string>; readonly modeTtlMs?: number },
  reply: BridgeReply,
): BridgeCore {
  const ttl = options.modeTtlMs ?? MODE_TTL_MS;
  const targets = new Map<number, { readonly element: Element; readonly kind: TargetKind }>();
  let forwarding:
    | {
        readonly onKey: (event: KeyboardEvent) => void;
        readonly onPointer: () => void;
        readonly origin: string;
        timer: number;
      }
    | undefined;

  /** Stop forwarding; `told` names why when the parent should hear of it. */
  const stopForwarding = (told?: "pointer" | "lapsed") => {
    if (forwarding === undefined) return;
    const { onKey, onPointer, origin, timer } = forwarding;
    forwarding = undefined;
    win.removeEventListener("keydown", onKey, { capture: true });
    win.removeEventListener("pointerdown", onPointer, { capture: true });
    win.clearTimeout(timer);
    if (told !== undefined) reply({ bbim: BRIDGE_PROTOCOL, type: "leave", reason: told }, origin);
  };

  const lapse = () => stopForwarding("lapsed");

  const startForwarding = (origin: string) => {
    if (forwarding !== undefined) {
      // A renewal: forwarding goes on for another `ttl`.
      win.clearTimeout(forwarding.timer);
      forwarding.timer = win.setTimeout(lapse, ttl);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      // Held keys and IME composition are swallowed but never typed into a label.
      // oxlint-disable-next-line typescript/no-deprecated -- keyCode 229 is how Safari marks IME keys.
      const composing = event.isComposing || event.key === "Process" || event.keyCode === 229;
      if (event.repeat || composing) return;
      const { key, code, ctrlKey, altKey, metaKey, shiftKey } = event;
      reply(
        {
          bbim: BRIDGE_PROTOCOL,
          type: "key",
          key: key.slice(0, 64),
          code: code.slice(0, 64),
          ctrlKey,
          altKey,
          metaKey,
          shiftKey,
          repeat: false,
          isComposing: false,
        },
        origin,
      );
      // Escape ends the parent's hint mode, which ends forwarding; do not wait for it.
      if (key === "Escape") stopForwarding();
    };
    // A click inside the frame ends hints, as a click on the page does.
    const onPointer = () => stopForwarding("pointer");
    forwarding = { onKey, onPointer, origin, timer: win.setTimeout(lapse, ttl) };
    win.addEventListener("keydown", onKey, { capture: true });
    win.addEventListener("pointerdown", onPointer, { capture: true });
  };

  const receive = (message: ParentMessage, from: string) => {
    switch (message.type) {
      case "collect": {
        const found = frameTree(win.document).documents.flatMap((placement) =>
          collectTargets(placement, { selectors: options.selectors ?? DEFAULT_SELECTORS }),
        );
        targets.clear();
        found.forEach((target, id) => targets.set(id, { element: target.element, kind: target.kind }));
        reply(
          {
            bbim: BRIDGE_PROTOCOL,
            type: "targets",
            requestId: message.requestId,
            // `faded` is optional in the protocol: sent only when true.
            targets: found.map((target, id) => ({
              id,
              kind: target.kind,
              ...target.rect,
              ...(target.faded ? { faded: true } : {}),
            })),
          },
          from,
        );
        return;
      }
      case "activate": {
        const target = targets.get(message.targetId);
        if (target === undefined || !target.element.isConnected) return;
        activateElement(target.element, target.kind, {
          newTab: message.newTab,
          openUrl: (url) => {
            if (!isOpenableUrl(url)) return false;
            reply({ bbim: BRIDGE_PROTOCOL, type: "open", requestId: message.requestId, url }, from);
            return true;
          },
        });
        return;
      }
      case "mode":
        if (message.active) startForwarding(from);
        else stopForwarding();
        return;
    }
  };

  return {
    receive,
    dispose: () => {
      stopForwarding();
      targets.clear();
    },
  };
}

/** Install the bridge; the returned function removes it. Refuses (and warns) without origins or when one is already installed. */
export function installBbimBridge(options: BridgeOptions): () => void {
  const win = options.window ?? window;
  const origins = new Set(options.parentOrigins.filter((origin) => origin !== "" && origin !== "*"));
  if (origins.size === 0) {
    // The frame side has no Effect runtime (see the header): a plain warning for the embedder.
    // @effect-diagnostics-next-line globalConsole:off
    console.warn("bbim bridge: not installed; name the parent origins it may answer");
    return NOTHING;
  }
  if (INSTALLED in win) {
    // The frame side has no Effect runtime (see the header): a plain warning for the embedder.
    // @effect-diagnostics-next-line globalConsole:off
    console.warn("bbim bridge: already installed in this window");
    return NOTHING;
  }
  const parent = win.parent;
  if (parent === win) return NOTHING;
  Object.defineProperty(win, INSTALLED, { value: true, configurable: true });

  const core = bridgeCore(win, options, (message, origin) => {
    parent.postMessage(message, origin === "null" ? "*" : origin);
  });
  const onMessage = (event: MessageEvent) => {
    if (event.source !== parent || !origins.has(event.origin)) return;
    const message = decodeParentMessage(event.data);
    if (message === undefined) return;
    // An opaque origin can be anyone: it may only ask for targets.
    if (message.type !== "collect" && event.origin === "null") return;
    core.receive(message, event.origin);
  };
  let installed = true;
  win.addEventListener("message", onMessage);
  return () => {
    if (!installed) return;
    installed = false;
    win.removeEventListener("message", onMessage);
    core.dispose();
    Reflect.deleteProperty(win, INSTALLED);
  };
}
