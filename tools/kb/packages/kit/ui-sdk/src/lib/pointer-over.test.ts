import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { placeOver, trackPointerOver, usePointerOver, type PointerSource } from "./pointer-over";

const BOX = { left: 100, top: 50, width: 400, height: 200 };

describe("placeOver", () => {
  it("is the pointer's place from the frame's corner", () => {
    expect(placeOver(BOX, { x: 130, y: 90 })).toEqual({ x: 30, y: 40 });
  });
  it("is none outside the frame, on every side", () => {
    for (const client of [
      { x: 99, y: 100 },
      { x: 501, y: 100 },
      { x: 200, y: 49 },
      { x: 200, y: 251 },
    ]) {
      expect(placeOver(BOX, client)).toBeNull();
    }
  });
  it("counts the frame's own edge as over it", () => {
    expect(placeOver(BOX, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(placeOver(BOX, { x: 500, y: 250 })).toEqual({ x: 400, y: 200 });
  });
});

type Box = { left: number; top: number; width: number; height: number };

/** `element` laid out at `box`, read through a spy that counts layout reads. */
function laidOut(element: Element, box: Box) {
  const read = vi.fn(() => ({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box,
  }));
  element.getBoundingClientRect = read;
  return {
    read,
    move: (next: Box) => Object.assign(box, next),
  };
}

describe("trackPointerOver", () => {
  let dom: Window;
  let resized: (() => void)[];
  let observed: Set<unknown>;
  beforeEach(() => {
    dom = new Window();
    resized = [];
    observed = new Set();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(changed: () => void) {
          resized.push(changed);
        }
        observe(element: unknown) {
          observed.add(element);
        }
        unobserve(element: unknown) {
          observed.delete(element);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A frame inside `inner`, inside `outer`; `inner` covers the frame at first. */
  function page() {
    const document = dom.document;
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    const frame = document.createElement("div");
    inner.append(frame);
    outer.append(inner);
    document.body.append(outer);
    const at = {
      outer: laidOut(outer as unknown as Element, { left: 0, top: 0, width: 1000, height: 1000 }),
      inner: laidOut(inner as unknown as Element, { left: 50, top: 0, width: 600, height: 300 }),
      frame: laidOut(frame as unknown as Element, { left: 100, top: 50, width: 400, height: 200 }),
    };
    const point = (target: typeof outer, x: number, y: number) =>
      target.dispatchEvent(new dom.PointerEvent("pointermove", { clientX: x, clientY: y }));
    return { outer, inner, frame: frame as unknown as HTMLElement, at, point };
  }

  it("answers now() from what it measured, reading no layout", () => {
    const { inner, frame, at, point } = page();
    const tracker = trackPointerOver(frame);
    point(inner, 130, 90);
    const reads = at.frame.read.mock.calls.length;
    for (let i = 0; i < 100; i++) expect(tracker.now()).toEqual({ x: 30, y: 40 });
    expect(at.frame.read.mock.calls.length).toBe(reads);
    tracker.stop();
  });

  it("measures the frame again when the pointer moves and when the page scrolls", () => {
    const { inner, frame, at, point } = page();
    const tracker = trackPointerOver(frame);
    point(inner, 130, 90);
    at.frame.move({ left: 110, top: 50, width: 400, height: 200 });
    point(inner, 130, 90);
    expect(tracker.now()).toEqual({ x: 20, y: 40 });
    at.frame.move({ left: 110, top: 30, width: 400, height: 200 });
    dom.dispatchEvent(new dom.Event("scroll"));
    expect(tracker.now()).toEqual({ x: 20, y: 60 });
    tracker.stop();
  });

  it("listens on what covers the frame once its box changes", () => {
    const { outer, frame, at, point } = page();
    const tracker = trackPointerOver(frame);
    point(outer, 130, 90);
    expect(tracker.now()).toBeNull();
    at.frame.move({ left: 20, top: 50, width: 400, height: 200 });
    for (const changed of resized) changed();
    point(outer, 30, 90);
    expect(tracker.now()).toEqual({ x: 10, y: 40 });
    tracker.stop();
  });

  it("measures again when what covers it or the page changes size: a shift above it", () => {
    const { inner, frame, at, point } = page();
    const tracker = trackPointerOver(frame);
    expect(observed).toEqual(new Set([frame, inner, dom.document.documentElement]));
    point(inner, 130, 90);
    // Content added above it moves the frame down, its own size the same.
    at.frame.move({ left: 100, top: 80, width: 400, height: 200 });
    for (const changed of resized) changed();
    expect(tracker.now()).toEqual({ x: 30, y: 10 });
    tracker.stop();
  });

  it("hears nothing once stopped", () => {
    const { inner, frame, point } = page();
    const tracker = trackPointerOver(frame);
    tracker.stop();
    point(inner, 130, 90);
    expect(tracker.now()).toBeNull();
  });
});

/** A slot whose frame mounts only once it is `shown`, telling `report` its pointer source. */
function Slot({ shown, report }: { shown: boolean; report: (source: PointerSource) => void }) {
  const [source, attach] = usePointerOver();
  useLayoutEffect(() => report(source), [source, report]);
  return shown ? createElement("div", { ref: attach, "data-frame": "" }) : null;
}

describe("usePointerOver", () => {
  let dom: Window;
  beforeEach(() => {
    dom = new Window();
    vi.stubGlobal("window", dom);
    vi.stubGlobal("document", dom.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows a frame that mounts after the hook first runs", () => {
    const seen: { source: PointerSource | null } = { source: null };
    const report = (source: PointerSource) => {
      seen.source = source;
    };
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host as unknown as HTMLElement);
    act(() => root.render(createElement(Slot, { shown: false, report })));
    act(() => root.render(createElement(Slot, { shown: true, report })));
    const frame = host.querySelector("[data-frame]");
    if (frame === null) throw new Error("the frame did not mount");
    laidOut(frame as unknown as Element, { left: 10, top: 10, width: 100, height: 50 });
    // The frame measured as it attached, before its box was laid out here: a move measures again.
    frame.dispatchEvent(
      new dom.PointerEvent("pointermove", { clientX: 30, clientY: 20, bubbles: true }),
    );
    expect(seen.source?.now()).toEqual({ x: 20, y: 10 });
    act(() => root.unmount());
    expect(seen.source?.now()).toBeNull();
  });
});
