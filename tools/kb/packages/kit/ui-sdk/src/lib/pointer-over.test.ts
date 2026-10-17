import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { placeOver, trackPointerOver } from "./pointer-over";

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
  beforeEach(() => {
    dom = new Window();
    resized = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(changed: () => void) {
          resized.push(changed);
        }
        observe() {}
        disconnect() {}
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

  it("hears nothing once stopped", () => {
    const { inner, frame, point } = page();
    const tracker = trackPointerOver(frame);
    tracker.stop();
    point(inner, 130, 90);
    expect(tracker.now()).toBeNull();
  });
});
