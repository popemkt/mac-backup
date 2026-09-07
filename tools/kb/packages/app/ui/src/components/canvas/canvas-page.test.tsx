import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import { stringifyCanvasDoc, type CanvasDoc } from "@kb/canvas";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID, type OutlineNode } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

const { persistCanvasDoc } = vi.hoisted(() => ({
  persistCanvasDoc: vi
    .fn<(canvasId: string, doc: CanvasDoc, opts?: unknown) => Promise<boolean>>()
    .mockResolvedValue(true),
}));

vi.mock("@/lib/canvas-api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, persistCanvasDoc };
});

import { CanvasPage } from "./canvas-page";

const initialDoc: CanvasDoc = {
  nodes: [
    { id: "a", type: "shape", shape: "rect", x: 20, y: 20, width: 100, height: 80 },
    { id: "b", type: "shape", shape: "rect", x: 220, y: 20, width: 100, height: 80 },
  ],
  edges: [],
};

const canvasNode: OutlineNode = {
  id: "canvas",
  text: "Characterization canvas",
  parentId: null,
  children: [],
  collapsed: false,
  props: {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.canvasTag }],
    [SYSTEM_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(initialDoc) }],
  },
  tags: [],
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: PointerEventInit,
): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }),
    );
  });
}

describe("CanvasPage pointer interactions", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window({ url: "https://kb.test/canvas/canvas" });
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.SVGElement = dom.SVGElement;
    g.Node = dom.Node;
    g.Event = dom.Event;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.PointerEvent = dom.PointerEvent;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(dom.HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: () => undefined,
    });
  });

  beforeEach(() => {
    persistCanvasDoc.mockClear();
    useOutlineStore.setState({
      nodes: new Map([[canvasNode.id, canvasNode]]),
      wireNodes: [],
      index: null,
      rev: 0,
      rootNodeId: WORKSPACE_ROOT_ID,
      homeRootId: WORKSPACE_ROOT_ID,
      activeNodeId: null,
      activeInstanceKey: null,
      selectedNodeId: null,
      selectedInstanceKey: null,
      loadSource: null,
      loadError: null,
    });
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("selects, drags, marquees, pans, resizes, connects, and undoes through the DOM", async () => {
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });

    const canvasStage = present(
      container.querySelector("[data-canvas-stage]"),
      "canvas stage contents",
    );
    const transformLayer = present(canvasStage.parentElement, "canvas transform layer");
    const pointerSurface = present(transformLayer.parentElement, "canvas pointer surface");

    const cardA = present(
      container.querySelector('[data-card-id="a"] .group\\/card'),
      "first card",
    );
    dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 60, clientY: 60 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 70, clientY: 70 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 80, clientY: 70 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 80, clientY: 70 });

    dispatchPointer(pointerSurface, "pointerdown", { button: 0, clientX: 40, clientY: 40 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 450, clientY: 250 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 451, clientY: 251 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 451, clientY: 251 });
    expect(
      present(container.querySelector('[data-card-id="a"]'), "marquee card a").querySelector(
        "[data-resize]",
      ),
    ).not.toBeNull();
    expect(
      present(container.querySelector('[data-card-id="b"]'), "marquee card b").querySelector(
        "[data-resize]",
      ),
    ).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Space", key: " " }),
      );
    });
    dispatchPointer(pointerSurface, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 140, clientY: 130 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 140, clientY: 130 });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, code: "Space", key: " " }));
    });
    expect(transformLayer.getAttribute("style")).toContain("translate(80px, 70px)");

    const resizeA = present(
      container.querySelector('[data-card-id="a"] [data-resize="se"]'),
      "first card resize handle",
    );
    dispatchPointer(resizeA, "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 20, clientY: 15 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 25, clientY: 20 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 25, clientY: 20 });

    const fromPort = present(
      container.querySelector('[data-card-id="a"] [data-port="right"]'),
      "first card right port",
    );
    const cardB = present(container.querySelector('[data-card-id="b"]'), "second card");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(cardB);
    dispatchPointer(fromPort, "pointerdown", { button: 0, clientX: 165, clientY: 140 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 300, clientY: 130 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 300, clientY: 130 });
    await act(async () => Promise.resolve());

    const withEdge = persistCanvasDoc.mock.calls.find(([, doc]) => doc.edges.length === 1)?.[1];
    expect(withEdge).toBeDefined();
    expect(withEdge?.edges[0]).toMatchObject({
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }),
      );
    });
    await act(async () => Promise.resolve());

    const lastPersist = present(persistCanvasDoc.mock.calls.at(-1), "undo persistence")[1];
    expect(lastPersist.edges).toEqual([]);
    expect(lastPersist.nodes.find((node) => node.id === "a")).toMatchObject({
      x: 40,
      y: 30,
      width: 125,
      height: 100,
    });
  });
});
