import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import type { CanvasDoc } from "@kb/canvas";
import { fixtureGraph } from "@/fixtures/graph";
import { useOutlineStore } from "@/stores/outline.store";
import { CanvasPage } from "./canvas-page";
import type * as CanvasApi from "@/lib/canvas-api";

const doc: CanvasDoc = {
  nodes: [
    { id: "a", type: "shape", shape: "rect", label: "A", x: 0, y: 0, width: 160, height: 100 },
    { id: "b", type: "shape", shape: "rect", label: "B", x: 300, y: 200, width: 160, height: 100 },
  ],
  edges: [],
};
vi.mock("@/lib/canvas-api", async (original) => ({
  ...(await original<typeof CanvasApi>()),
  readCanvasDoc: () => doc,
  syncDocOnRev: () => {},
  persistCanvasDoc: vi.fn(async () => {}),
}));

describe("canvas gestures", () => {
  let dom: Window;
  let root: Root;
  let container: HTMLElement;
  let stage: HTMLElement;
  beforeAll(() => {
    dom = new Window({ url: "https://kb.test/" });
    Object.assign(globalThis, {
      window: dom,
      document: dom.document,
      HTMLElement: dom.HTMLElement,
      HTMLInputElement: dom.HTMLInputElement,
      HTMLTextAreaElement: dom.HTMLTextAreaElement,
      IS_REACT_ACT_ENVIRONMENT: true,
      Node: dom.Node,
      KeyboardEvent: dom.KeyboardEvent,
      PointerEvent: dom.PointerEvent,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: clearTimeout,
    });
    dom.HTMLElement.prototype.setPointerCapture = () => {};
  });
  beforeEach(() => {
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
    const canvasId = present(fixtureGraph.nodes[0], "fixture node").id;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<CanvasPage canvasId={canvasId} />));
    stage = present(
      container.querySelector<HTMLElement>("[data-canvas-viewport]"),
      "canvas viewport",
    );
    stage.getBoundingClientRect = () => ({
      left: 240,
      top: 120,
      width: 900,
      height: 600,
      right: 1140,
      bottom: 720,
      x: 240,
      y: 120,
      toJSON() {},
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const pointer = (target: Element, type: string, x: number, y: number, shiftKey = false) => {
    act(() => {
      target.dispatchEvent(
        new dom.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          clientX: x,
          clientY: y,
          shiftKey,
        }) as unknown as Event,
      );
    });
  };
  const card = () => container.querySelector('[data-card-id="a"] .group\\/card') as HTMLElement;

  it("keeps connection preview on the cursor with an offset viewport, pan and zoom", () => {
    const wheel = new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    Object.defineProperties(wheel, {
      ctrlKey: { value: true },
      clientX: { value: 600 },
      clientY: { value: 400 },
    });
    act(() => {
      stage.dispatchEvent(wheel as unknown as Event);
    });
    pointer(
      present(card().querySelector('[data-port="right"]'), "right port"),
      "pointerdown",
      450,
      220,
    );
    pointer(stage, "pointermove", 730, 510);
    const path = present(
      present(
        container.querySelector('[data-testid="canvas-connection-preview"]'),
        "connection preview",
      ).getAttribute("d"),
      "path data",
    );
    const numbers = present(path.match(/-?\d+(?:\.\d+)?/g), "path coordinates").map(Number);
    // Zoom at (600,400): pan becomes (14.4,20.8), zoom 1.08.
    expect(numbers.at(-2)).toBeCloseTo((730 - 240 - 14.4) / 1.08);
    expect(numbers.at(-1)).toBeCloseTo((510 - 120 - 20.8) / 1.08);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[data-testid="canvas-connection-preview"]')).toBeNull();
  });

  it("keeps snapped release geometry and undoes the whole drag", () => {
    pointer(card(), "pointerdown", 300, 200);
    pointer(stage, "pointermove", 310, 210);
    pointer(stage, "pointermove", 439, 230);
    const preview = card().style.left;
    expect(preview).toBe("140px");
    pointer(stage, "pointerup", 439, 230);
    expect(card().style.left).toBe(preview);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
      );
    });
    expect(card().style.left).toBe("0px");
  });

  it("cancels a move without losing its original position", () => {
    pointer(card(), "pointerdown", 300, 200);
    pointer(stage, "pointermove", 310, 210);
    pointer(stage, "pointermove", 390, 240);
    pointer(stage, "pointercancel", 390, 240);
    expect(card().style.left).toBe("0px");
  });

  it("resizes from every corner and keeps the opposite corner fixed with Shift", () => {
    pointer(card(), "pointerdown", 300, 200);
    pointer(stage, "pointerup", 300, 200);
    expect(card().querySelectorAll("[data-resize]")).toHaveLength(4);
    pointer(
      present(card().querySelector('[data-resize="nw"]'), "northwest resize"),
      "pointerdown",
      300,
      200,
    );
    pointer(stage, "pointermove", 220, 170, true);
    expect(card().style.width).toBe("208px");
    expect(card().style.height).toBe("130px");
    expect(card().style.left).toBe("-48px");
    expect(card().style.top).toBe("-30px");
    pointer(stage, "pointerup", 220, 170, true);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
      );
    });
    expect(card().style.width).toBe("160px");
    expect(card().style.left).toBe("0px");
  });

  it("pans with Space even when the gesture starts over a card", () => {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }),
      );
    });
    pointer(card(), "pointerdown", 300, 200);
    pointer(stage, "pointermove", 390, 240);
    pointer(stage, "pointerup", 390, 240);
    expect(card().style.left).toBe("0px");
    expect(
      present(stage.querySelector<HTMLElement>(".origin-top-left"), "transform layer").style
        .transform,
    ).toContain("translate(130px, 80px)");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
    });
  });
});
