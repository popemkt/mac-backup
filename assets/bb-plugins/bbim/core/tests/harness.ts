// A happy-dom page with just enough layout for bbim: happy-dom renders
// nothing, so every element's box comes from its `data-rect="left,top,width,height"`
// and hit-testing returns the last element in document order whose box holds the point.
import { Window } from "happy-dom";

export interface Page {
  readonly win: globalThis.Window & typeof globalThis;
  readonly doc: Document;
  /** Dispatch a keydown at the focused element (or body), as a person typing. */
  key(key: string, init?: Partial<KeyboardEventInit> & { code?: string }): KeyboardEvent;
  /** The labels the overlay shows, in order, visible ones only. */
  labels(): Array<string>;
  overlayHost(): Element | null;
  close(): void;
}

function rectOf(element: Element) {
  const raw = element.getAttribute("data-rect");
  const [left = 0, top = 0, width = 0, height = 0] = (raw ?? "0,0,0,0").split(",").map(Number);
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

/** Hit-test `doc` by `data-rect`: the last element in document order whose box holds the point. */
function hitTest(doc: Document): void {
  const hits = (x: number, y: number) =>
    [...doc.querySelectorAll("[data-rect]")]
      .filter((element) => {
        const box = rectOf(element);
        return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
      })
      .toReversed();
  doc.elementFromPoint = (x: number, y: number) => hits(x, y)[0] ?? null;
  doc.elementsFromPoint = (x: number, y: number) => hits(x, y);
}

export function page(html: string): Page {
  const happy = new Window({ url: "https://app.test/", width: 1000, height: 800 });
  const win = happy as unknown as globalThis.Window & typeof globalThis;
  const doc = win.document;
  doc.body.innerHTML = html;
  const proto = (win as unknown as { Element: typeof Element }).Element.prototype;
  proto.getBoundingClientRect = function (this: Element) {
    return rectOf(this);
  };
  proto.getClientRects = function (this: Element) {
    const rect = rectOf(this);
    return (rect.width > 0 ? [rect] : []) as unknown as DOMRectList;
  };
  hitTest(doc);
  return {
    win,
    doc,
    key: (key, init = {}) => {
      const target = doc.activeElement ?? doc.body;
      const event = new (win as unknown as typeof globalThis).KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    },
    labels: () => {
      const host = doc.querySelector("[data-bbim-overlay]");
      const nodes = host?.shadowRoot?.querySelectorAll(".hint") ?? [];
      return [...nodes].filter((node) => !(node as HTMLElement).hidden).map((node) => node.textContent);
    },
    overlayHost: () => doc.querySelector("[data-bbim-overlay]"),
    close: () => {
      void happy.happyDOM.close();
    },
  };
}

/**
 * Make an iframe act as a laid-out same-origin frame, as a browser reports
 * one: happy-dom gives it no client size and its window no frameElement.
 */
export function layOutFrame(frame: HTMLIFrameElement): Document {
  const rect = frame.getBoundingClientRect();
  Object.defineProperty(frame, "clientWidth", { value: rect.width, configurable: true });
  Object.defineProperty(frame, "clientHeight", { value: rect.height, configurable: true });
  const inner = frame.contentDocument;
  const view = frame.contentWindow;
  if (inner === null || view === null) throw new Error("the frame has no document");
  Object.defineProperty(view, "frameElement", { value: frame, configurable: true });
  hitTest(inner);
  return inner;
}
