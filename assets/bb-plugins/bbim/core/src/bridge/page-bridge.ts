// The bridge for a native page: a page a host shows in a native view (bb's
// desktop Browser tab) and reaches by script instead of postMessage. Same
// protocol and decoders as an iframe's bridge, over the host's channel:
// requests arrive by `receive` (the host evaluates a call to it in the page),
// replies leave by `post` (bb: `bb.postMessage` in its isolated world).
//
// A native view covers the parent's overlay, so this side also draws the
// labels the parent assigns (`labels`, `typed`). Only input the browser marks
// as a person's counts. Each install names its document
// with a fresh nonce (`ready`): `mode` for any other document is refused, so
// a page that navigated mid-hint never swallows keys for a stale session.
// Plain DOM: bundled into bridge/bbim-page.ts (scripts/build-bridge.mjs).
import { BRIDGE_PROTOCOL, decodeParentMessage, type FrameMessage } from "../domain/protocol.ts";
import { intersect } from "../domain/targets.ts";
import { viewportOf } from "../dom/collect.ts";
import { frameTree } from "../dom/frames.ts";
import { applyTheme, LABEL_STYLE, type LabelLayer, labelLayer, layerHost } from "../dom/label-layer.ts";
import { bridgeCore } from "./bbim-bridge.ts";

/** The global a page bridge is installed under (the host's script calls its `receive`). */
export const PAGE_BRIDGE = Symbol.for("bbim.page");

export interface PageBridge {
  /** This document's nonce, as announced in `ready`. */
  readonly document: string;
  /** One request from the host, untrusted until decoded. */
  readonly receive: (data: unknown) => void;
  readonly uninstall: () => void;
}

function nonce(win: Window): string {
  const bytes = new Uint8Array(12);
  win.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function installPageBridge(options: {
  readonly window: Window;
  readonly post: (message: FrameMessage) => void;
}): PageBridge {
  const win = options.window;
  const doc = win.document;
  const document = nonce(win);
  const core = bridgeCore(win, { trustedOnly: true }, (message) => options.post(message));
  let drawn: { readonly host: HTMLElement; readonly layer: LabelLayer } | undefined;

  const hideLabels = () => {
    drawn?.layer.hide();
    drawn?.host.remove();
    drawn = undefined;
  };

  const showLabels = (labels: ReadonlyArray<{ readonly id: number; readonly label: string }>) => {
    hideLabels();
    const view = viewportOf(doc);
    const views = labels.flatMap(({ id, label }) => {
      const element = core.target(id);
      const box = element?.getBoundingClientRect();
      const rect = box === undefined ? undefined : intersect({ left: box.left, top: box.top, width: box.width, height: box.height }, view);
      return rect === undefined ? [] : [{ label, rect }];
    });
    if (views.length === 0) return;
    const { host, layer } = layerHost(doc, LABEL_STYLE);
    applyTheme(host, {});
    doc.documentElement.append(host);
    drawn = { host, layer: labelLayer(layer) };
    drawn.layer.show(views);
  };

  // A person's click in the page leaves hint mode (the core tells the parent while it forwards); labels go with it.
  const onPointer = (event: Event) => {
    if (event.isTrusted) hideLabels();
  };
  /** The windows listened on: this one and every same-origin frame's (clicks in a frame stay there). */
  const listening = new Set<Window>();
  const listenEverywhere = () => {
    for (const placement of frameTree(doc).documents) {
      const each = placement.doc.defaultView;
      if (each === null || listening.has(each)) continue;
      listening.add(each);
      each.addEventListener("pointerdown", onPointer, { capture: true });
    }
  };
  const announce = () => options.post({ bbim: BRIDGE_PROTOCOL, type: "ready", document });
  listenEverywhere();
  announce();

  return {
    document,
    receive: (data) => {
      const message = decodeParentMessage(data);
      if (message === undefined) return;
      switch (message.type) {
        case "labels":
          showLabels(message.labels);
          return;
        case "typed":
          drawn?.layer.narrow(message.typed);
          return;
        case "chords":
          core.receive(message, "page");
          // The host repeats these: frames loaded since get listened on too, and
          // a host that came up after this bridge learns its document.
          listenEverywhere();
          announce();
          return;
        case "mode":
          // Forwarding is for the session the parent runs with this very document.
          if (message.active && message.document !== document) return;
          core.receive(message, "page");
          return;
        case "collect":
        case "activate":
        case "scroll":
          core.receive(message, "page");
      }
    },
    uninstall: () => {
      for (const each of listening) each.removeEventListener("pointerdown", onPointer, { capture: true });
      listening.clear();
      hideLabels();
      core.dispose();
    },
  };
}
