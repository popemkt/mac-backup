// The bridge for a native page: a page a host shows in a native view (bb's
// desktop Browser tab) and reaches by script instead of postMessage. Same
// protocol and decoders as an iframe's bridge, over the host's channel:
// requests arrive by `receive` (the host evaluates a call to it in the page),
// replies leave by `post` (bb: `bb.postMessage` in its isolated world).
//
// A native view covers the parent's overlay, so this side also draws the
// labels the parent assigns (`labels`, `typed`), and, because it keeps every
// key typed in it, passes the parent's own chords back (`chords`). Only keys
// the browser marks as typed by a person count. Plain DOM: bundled into
// bridge/bbim-page.ts with the rest of the bridge (scripts/build-bridge.mjs).
import { decodeParentMessage, type FrameMessage, type ParentMessage } from "../domain/protocol.ts";
import { intersect } from "../domain/targets.ts";
import { viewportOf } from "../dom/collect.ts";
import { applyTheme, LABEL_STYLE, type LabelLayer, labelLayer, layerHost } from "../dom/label-layer.ts";
import { bridgeCore, keyMessage } from "./bbim-bridge.ts";

/** The global a page bridge is installed under (the host's script calls its `receive`). */
export const PAGE_BRIDGE = Symbol.for("bbim.page");

export interface PageBridge {
  /** One request from the host, untrusted until decoded. */
  readonly receive: (data: unknown) => void;
  readonly uninstall: () => void;
}

type Chord = Extract<ParentMessage, { readonly type: "chords" }>["chords"][number];

export function installPageBridge(options: {
  readonly window: Window;
  readonly post: (message: FrameMessage) => void;
}): PageBridge {
  const win = options.window;
  const doc = win.document;
  const core = bridgeCore(win, { trustedKeysOnly: true }, (message) => options.post(message));
  let chords: ReadonlyArray<Chord> = [];
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

  const onKey = (event: KeyboardEvent) => {
    // While forwarding, the core takes every key; a made-up key is never a chord.
    if (core.forwarding() || !event.isTrusted || event.repeat) return;
    const chord = chords.some(
      (each) =>
        each.code === event.code &&
        each.ctrlKey === event.ctrlKey &&
        each.altKey === event.altKey &&
        each.metaKey === event.metaKey &&
        each.shiftKey === event.shiftKey,
    );
    if (!chord) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    options.post(keyMessage(event));
  };
  // A click in the page leaves hint mode (the core tells the parent while it forwards); labels go with it.
  const onPointer = () => hideLabels();
  win.addEventListener("keydown", onKey, { capture: true });
  win.addEventListener("pointerdown", onPointer, { capture: true });

  return {
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
          chords = message.chords;
          return;
        case "collect":
        case "activate":
        case "mode":
          core.receive(message, "page");
      }
    },
    uninstall: () => {
      win.removeEventListener("keydown", onKey, { capture: true });
      win.removeEventListener("pointerdown", onPointer, { capture: true });
      hideLabels();
      core.dispose();
    },
  };
}
