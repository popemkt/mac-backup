// The in-frame side of the hint bridge. Include it in a page that is shown in
// a frame its parent cannot script (cross-origin, or sandboxed without
// allow-same-origin) and the parent's hints reach into it. Protocol:
// ../domain/protocol.ts; embedding: ../../README.md.
//
// It answers only its parent window, decodes every request with the
// protocol's schemas, and never acts on anything else. The built,
// dependency-free script is ../../bridge/bbim-bridge.js.
import { Effect, Option } from "effect";
import { BRIDGE_PROTOCOL, decodeParentMessage, type FrameMessage, isOpenableUrl } from "../domain/protocol.ts";
import type { TargetKind } from "../domain/targets.ts";
import { activateElement } from "../dom/activate.ts";
import { collectTargets, DEFAULT_SELECTORS } from "../dom/collect.ts";
import { frameTree } from "../dom/frames.ts";
import { listen } from "../dom/resources.ts";
import { openScope, type ScopeHandle } from "../dom/runtime.ts";

export interface BridgeOptions {
  /** The frame's window. Defaults to the global one. */
  readonly window?: Window;
  /**
   * Parent origins to answer. Defaults to any: the bridge only ever answers
   * `window.parent`, and a sandboxed frame cannot know its parent's origin.
   * Name the origins when you can.
   */
  readonly parentOrigins?: ReadonlyArray<string>;
  readonly selectors?: ReadonlyArray<string>;
}

/** Install the bridge; the returned function removes it. */
export function installBbimBridge(options: BridgeOptions = {}): () => void {
  const win = options.window ?? window;
  const parent = win.parent;
  if (parent === win) return () => {};
  const root = openScope();
  let targets = new Map<number, { readonly element: Element; readonly kind: TargetKind }>();
  let forwarding: ScopeHandle | undefined;

  const reply = (message: FrameMessage, origin: string) => {
    parent.postMessage(message, origin === "null" ? "*" : origin);
  };

  const setForwarding = (active: boolean, origin: string) => {
    forwarding?.close();
    forwarding = undefined;
    if (!active) return;
    forwarding = root.child();
    forwarding.run(
      listen<KeyboardEvent>(
        win,
        "keydown",
        (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const { key, code, ctrlKey, altKey, metaKey, shiftKey } = event;
          reply({ bbim: BRIDGE_PROTOCOL, type: "key", key: key.slice(0, 64), code: code.slice(0, 64), ctrlKey, altKey, metaKey, shiftKey }, origin);
          // Escape ends the parent's hint mode, which ends forwarding; do not wait for it.
          if (key === "Escape") setForwarding(false, origin);
        },
        { capture: true },
      ),
    );
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== parent) return;
    if (options.parentOrigins !== undefined && !options.parentOrigins.includes(event.origin)) return;
    const decoded = decodeParentMessage(event.data);
    if (Option.isNone(decoded)) return;
    const message = decoded.value;
    switch (message.type) {
      case "collect": {
        const found = frameTree(win.document).documents.flatMap((placement) =>
          collectTargets(placement, { selectors: options.selectors ?? DEFAULT_SELECTORS }),
        );
        targets = new Map(found.map((target, id) => [id, { element: target.element, kind: target.kind }]));
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
            reply({ bbim: BRIDGE_PROTOCOL, type: "open", url }, event.origin);
            return true;
          },
        });
        return;
      }
      case "mode":
        setForwarding(message.active, event.origin);
        return;
    }
  };

  root.run(listen<MessageEvent>(win, "message", onMessage));
  root.run(Effect.addFinalizer(() => Effect.sync(() => forwarding?.close())));
  return () => root.close();
}
