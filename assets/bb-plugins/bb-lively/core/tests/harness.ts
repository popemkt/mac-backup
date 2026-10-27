// A happy-dom page for the motion layer, with a controllable
// prefers-reduced-motion and a way to wait for MutationObserver callbacks.
import { Window } from "happy-dom";
import type { Targets } from "../src/dom/targets.ts";

export interface Page {
  readonly win: globalThis.Window & typeof globalThis;
  readonly doc: Document;
  readonly root: HTMLElement;
  /** Flip the OS reduced-motion preference and fire the media query's change event. */
  setReducedMotion(reduced: boolean): void;
  /** Let MutationObserver callbacks and animation frames run. */
  settle(): Promise<void>;
  close(): void;
}

export function page(html = ""): Page {
  const happy = new Window({ url: "https://app.test/", width: 1000, height: 800 });
  const win = happy as unknown as globalThis.Window & typeof globalThis;
  win.document.body.innerHTML = html;
  let reduced = false;
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return reduced;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  win.matchMedia = (() => query) as unknown as typeof win.matchMedia;
  return {
    win,
    doc: win.document,
    root: win.document.documentElement,
    setReducedMotion: (next) => {
      reduced = next;
      for (const listener of listeners) listener();
    },
    settle: () => new Promise((resolve) => setTimeout(resolve, 20)),
    close: () => {
      void happy.happyDOM.close();
    },
  };
}

/** Targets shaped like a small chat app, the host-side half of the contract. */
export const TARGETS: Targets = {
  pressable: "button, [role=button]",
  pressExclude: "[data-drag-handle]",
  liftable: ".card",
  rowList: ".timeline",
  row: ".row",
  rowIdAttribute: "data-id",
  rowIndexAttribute: "data-index",
  focusBox: "form.composer",
  sendButton: "button.send",
  sendIcon: "button.send > svg",
  composerText: "form.composer .text",
  sentRow: ".row.mine",
  replyRow: ".row.reply",
  bubble: ".bubble",
  statusRow: ".thread",
  toast: ".toast",
  overlayOpen: '[role=menu][data-state="open"]',
  dialogOpen: '[role=dialog][data-state="open"]',
  overlayClosed: '[role=menu][data-state="closed"]',
  switchThumb: "[role=switch] > span",
  checkbox: "[role=checkbox]",
  pageView: ".page",
  sidebar: ".sidebar",
  dock: ".dock",
  dockFade: ".dock-fade",
  pendingRequest: ".request",
  working: ".working",
  hostAnimation: ".animate-in",
  suspendOn: ["data-measuring"],
};

/** A `.row` element for the `.timeline` list. */
export function rowHtml(id: string, index: number): string {
  return `<div class="row" data-id="${id}" data-index="${index}">${id}</div>`;
}
