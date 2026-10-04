import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import { stringifyCanvasDoc, type CanvasDoc } from "@kb/canvas";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID, type OutlineNode } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

const { persistCanvasDoc } = vi.hoisted(() => ({
  persistCanvasDoc: vi
    .fn<(canvasId: string, doc: CanvasDoc, opts?: unknown) => Promise<boolean>>()
    .mockResolvedValue(true),
}));

vi.mock("./canvas-api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, persistCanvasDoc };
});

import { CanvasPage } from "./canvas-page";
import { browserHostUiPlugin } from "@/browser-host";
import { syncUiPlugins } from "@/lib/plugins";

// The canvas reaches the shell through the page's host, as when the app boots.
beforeAll(() => syncUiPlugins([browserHostUiPlugin]));
afterAll(() => syncUiPlugins([]));

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

/** A key pressed on the window, as the canvas hears it. */
const key = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });

/** Past the canvas's persist debounce. */
const settle = () => act(async () => new Promise((done) => setTimeout(done, 350)));

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

  it("a member stands for its group until the group is entered; Esc leaves it; ⌘⇧G takes it apart", async () => {
    const framed: CanvasDoc = {
      nodes: [
        { id: "f", type: "group", label: "Ideas", x: 0, y: 0, width: 400, height: 200 },
        { id: "a", type: "text", text: "a", x: 20, y: 40, width: 120, height: 60, parent: "f" },
        { id: "b", type: "text", text: "b", x: 220, y: 40, width: 120, height: 60, parent: "f" },
      ],
      edges: [],
    };
    const node: OutlineNode = {
      ...canvasNode,
      props: {
        ...canvasNode.props,
        [SYSTEM_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(framed) }],
      },
    };
    useOutlineStore.setState({ nodes: new Map([[node.id, node]]) });
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage");
    const pointerSurface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    const faceOf = (id: string) =>
      present(container.querySelector(`[data-card-id="${id}"] .group\\/card`), `card ${id}`);
    const selected = () =>
      [...container.querySelectorAll<HTMLElement>("[data-card-id][data-selected]")].map(
        (el) => el.dataset.cardId,
      );
    const chip = () => container.querySelector('[data-testid="canvas-scope"]');

    // A press on a member selects its group, and a drag carries the group with its members.
    dispatchPointer(faceOf("a"), "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(selected()).toEqual(["f"]);
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 110, clientY: 100 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 137, clientY: 100 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 137, clientY: 100 });
    await settle();
    const carried = persistCanvasDoc.mock.calls.at(-1)?.[1];
    expect(carried?.nodes.map((n) => [n.id, n.x])).toEqual([
      ["f", 37],
      ["a", 57],
      ["b", 257],
    ]);

    // A double-click enters the group, selecting the member under it; Esc leaves, selecting the group.
    act(() => {
      faceOf("a").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    expect(selected()).toEqual(["a"]);
    expect(chip()?.textContent).toContain("Ideas");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(chip()).toBeNull();
    expect(selected()).toEqual(["f"]);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "G", metaKey: true, shiftKey: true }),
      );
    });
    await settle();
    const apart = persistCanvasDoc.mock.calls.at(-1)?.[1];
    expect(apart?.nodes.map((n) => [n.id, n.parent])).toEqual([
      ["a", undefined],
      ["b", undefined],
    ]);
    expect(selected()).toEqual(["a", "b"]);
  });

  it("present mode ends with its frame, and a frame made later does not bring it back", async () => {
    const framed: CanvasDoc = {
      nodes: [
        { id: "f", type: "group", label: "Ideas", x: 0, y: 0, width: 300, height: 200 },
        { id: "b", type: "text", text: "b", x: 500, y: 40, width: 120, height: 60 },
      ],
      edges: [],
    };
    const node: OutlineNode = {
      ...canvasNode,
      props: {
        ...canvasNode.props,
        [SYSTEM_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(framed) }],
      },
    };
    useOutlineStore.setState({ nodes: new Map([[node.id, node]]) });
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage");
    const pointerSurface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    const press = (id: string) => {
      const face = present(container.querySelector(`[data-card-id="${id}"] .group\\/card`), id);
      dispatchPointer(face, "pointerdown", { button: 0, clientX: 520, clientY: 60 });
      dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 520, clientY: 60 });
    };
    const bar = () => container.querySelector('[data-testid="canvas-present-bar"]');

    act(() => {
      present(container.querySelector<HTMLElement>("[aria-haspopup=menu]"), "view menu").click();
    });
    const start = [...container.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) =>
      item.textContent.startsWith("Present frames"),
    );
    act(() => start?.click());
    expect(bar()?.textContent).toContain("Ideas");

    // The frame presented is deleted: present mode ends.
    press("f");
    key({ key: "Delete" });
    expect(bar()).toBeNull();

    // A frame made later is not presented, and the arrows nudge again.
    press("b");
    key({ key: "g", metaKey: true });
    expect(bar()).toBeNull();
    key({ key: "ArrowRight", shiftKey: true });
    await settle();
    const last = persistCanvasDoc.mock.calls.at(-1)?.[1];
    expect(last?.nodes.find((n) => n.id === "b")?.x).toBe(510);
  });

  it("a placing tool sees through a frame: what it places there belongs to the frame", async () => {
    const framed: CanvasDoc = {
      nodes: [{ id: "f", type: "group", label: "Ideas", x: 0, y: 0, width: 600, height: 400 }],
      edges: [],
    };
    const node: OutlineNode = {
      ...canvasNode,
      props: {
        ...canvasNode.props,
        [SYSTEM_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(framed) }],
      },
    };
    useOutlineStore.setState({ nodes: new Map([[node.id, node]]) });
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "r" }));
    });
    const frame = present(container.querySelector('[data-card-id="f"] .group\\/card'), "frame");
    dispatchPointer(frame, "pointerdown", { button: 0, clientX: 200, clientY: 200 });
    await settle();
    const placed = persistCanvasDoc.mock.calls.at(-1)?.[1].nodes.at(-1);
    expect(placed).toMatchObject({ type: "shape", shape: "rect", parent: "f" });
  });

  it("a modal grab follows the pointer, and a press confirms or cancels it, reaching nothing", async () => {
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage");
    const pointerSurface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    const cardA = present(container.querySelector('[data-card-id="a"] .group\\/card'), "card a");
    dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 60, clientY: 60 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 60, clientY: 60 });
    const readout = () => container.querySelector('[data-testid="canvas-transform-readout"]');
    /** G, then the pointer 50 to the right with no button held. */
    const grab = () => {
      dispatchPointer(pointerSurface, "pointermove", { buttons: 0, clientX: 60, clientY: 60 });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "g" }));
      });
      dispatchPointer(pointerSurface, "pointermove", { buttons: 0, clientX: 110, clientY: 60 });
      expect(readout()).not.toBeNull();
    };
    const menu = () => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      act(() => {
        cardA.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    const persistedA = () =>
      persistCanvasDoc.mock.calls.at(-1)?.[1].nodes.find((node) => node.id === "a");

    // The right button cancels, its context menu swallowed; so does a Ctrl-click (macOS's).
    for (const init of [{ button: 2 }, { button: 0, ctrlKey: true }]) {
      grab();
      dispatchPointer(cardA, "pointerdown", { clientX: 110, clientY: 60, ...init });
      expect(readout()).toBeNull();
      expect(menu()).toBe(true);
      // Swallowed once: the next menu is the browser's.
      expect(menu()).toBe(false);
      await settle();
      expect(persistCanvasDoc).not.toHaveBeenCalled();
    }

    // A plain left press confirms, and it neither selects nor carries what is under it.
    grab();
    dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 110, clientY: 60 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 110, clientY: 60 });
    expect(readout()).toBeNull();
    await settle();
    expect(persistedA()).toMatchObject({ x: 70, y: 20 });
  });
});
