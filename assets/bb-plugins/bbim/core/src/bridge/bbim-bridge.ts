// The in-frame side of the hint bridge. Include it in a page that is shown in
// a frame its parent cannot script (cross-origin, or sandboxed without
// allow-same-origin) and the parent's hints reach into it. Protocol:
// ../domain/protocol.ts; embedding: ../../README.md.
//
// It fails closed: it installs only with an explicit list of parent origins,
// answers only `window.parent` from one of them, decodes every request with
// the protocol's schemas, and never lets an opaque ("null") origin switch on
// key forwarding or activate anything. Key forwarding also ends on its own
// when the parent stops renewing it, so a parent that dies mid-session
// cannot leave the frame swallowing keys.
//
// Plain DOM on purpose: this file and what it imports (collect, frames,
// activate, the protocol schemas) are all a frame bundles, so it stays free of
// Effect's runtime and scopes. The built script is ../../bridge/bbim-bridge.js.
import { Option } from "effect";
import {
  BRIDGE_PROTOCOL,
  decodeParentMessage,
  type FrameMessage,
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

  let installed = true;
  const ttl = options.modeTtlMs ?? MODE_TTL_MS;
  const targets = new Map<number, { readonly element: Element; readonly kind: TargetKind }>();
  let forwarding: { readonly listener: (event: KeyboardEvent) => void; timer: number } | undefined;

  const reply = (message: FrameMessage, origin: string) => {
    parent.postMessage(message, origin === "null" ? "*" : origin);
  };

  const stopForwarding = () => {
    if (forwarding === undefined) return;
    win.removeEventListener("keydown", forwarding.listener, { capture: true });
    win.clearTimeout(forwarding.timer);
    forwarding = undefined;
  };

  const startForwarding = (origin: string) => {
    if (forwarding !== undefined) {
      // A renewal: forwarding goes on for another `ttl`.
      win.clearTimeout(forwarding.timer);
      forwarding.timer = win.setTimeout(stopForwarding, ttl);
      return;
    }
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const { key, code, ctrlKey, altKey, metaKey, shiftKey } = event;
      reply({ bbim: BRIDGE_PROTOCOL, type: "key", key: key.slice(0, 64), code: code.slice(0, 64), ctrlKey, altKey, metaKey, shiftKey }, origin);
      // Escape ends the parent's hint mode, which ends forwarding; do not wait for it.
      if (key === "Escape") stopForwarding();
    };
    forwarding = { listener, timer: win.setTimeout(stopForwarding, ttl) };
    win.addEventListener("keydown", listener, { capture: true });
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== parent || !origins.has(event.origin)) return;
    const decoded = decodeParentMessage(event.data);
    if (Option.isNone(decoded)) return;
    const message = decoded.value;
    if (message.type !== "collect" && event.origin === "null") return;
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
            targets: found.map((target, id) => ({ id, kind: target.kind, ...target.rect })),
          },
          event.origin,
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
            reply({ bbim: BRIDGE_PROTOCOL, type: "open", requestId: message.requestId, url }, event.origin);
            return true;
          },
        });
        return;
      }
      case "mode":
        if (message.active) startForwarding(event.origin);
        else stopForwarding();
        return;
    }
  };

  win.addEventListener("message", onMessage);
  return () => {
    if (!installed) return;
    installed = false;
    win.removeEventListener("message", onMessage);
    stopForwarding();
    targets.clear();
    Reflect.deleteProperty(win, INSTALLED);
  };
}
