import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { CanvasDoc } from "@kb/canvas";
import type { OutlineNode } from "@/lib/types";

const { persistCanvasDoc } = vi.hoisted(() => ({
  persistCanvasDoc: vi
    .fn<(canvasId: string, doc: CanvasDoc, opts?: unknown) => Promise<boolean>>()
    .mockResolvedValue(true),
}));

vi.mock("@/lib/canvas-api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, persistCanvasDoc };
});

import { useCanvasDoc } from "./use-canvas-doc";

const empty: CanvasDoc = { nodes: [], edges: [] };
const isInteracting = () => false;
const first: CanvasDoc = {
  nodes: [{ id: "a", type: "text", text: "first", x: 0, y: 0, width: 100, height: 60 }],
  edges: [],
};
const last: CanvasDoc = {
  nodes: [{ id: "a", type: "text", text: "last", x: 0, y: 0, width: 100, height: 60 }],
  edges: [],
};
const canvasNode: OutlineNode = {
  id: "canvas",
  text: "Canvas",
  parentId: null,
  children: [],
  collapsed: false,
  props: {},
  tags: [],
  createdAt: "",
  updatedAt: "",
};

describe("useCanvasDoc persistence", () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof useCanvasDoc> | undefined;

  beforeAll(() => {
    const dom = new Window({ url: "https://kb.test/" });
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.Node = dom.Node;
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    persistCanvasDoc.mockClear();
    current = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    function Harness() {
      current = useCanvasDoc({
        canvasId: "canvas",
        canvasNode,
        nodes: new Map([[canvasNode.id, canvasNode]]),
        rev: 0,
        isInteracting,
      });
      return null;
    }
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    if (current) act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  test("persists only the last doc applied in a debounce window", () => {
    act(() => {
      current?.schedulePersist(first);
      current?.schedulePersist(last);
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(persistCanvasDoc).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(persistCanvasDoc).toHaveBeenCalledTimes(1);
    expect(persistCanvasDoc).toHaveBeenLastCalledWith("canvas", last);
  });

  test("an unfinished preview never leaks through an earlier commit timer", () => {
    act(() => {
      current?.schedulePersist(first);
      current?.previewDoc(last);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(persistCanvasDoc).toHaveBeenLastCalledWith("canvas", first);
    expect(current?.doc).toEqual(last);
    act(() => current?.cancelPreview());
    expect(current?.doc).toEqual(first);
  });

  test("committing a preview adds one undo step from its original document", () => {
    act(() => current?.schedulePersist(first));
    act(() => current?.previewDoc(last));
    act(() => current?.schedulePersist(last));
    act(() => current?.undo());
    expect(current?.doc).toEqual(first);
    act(() => current?.redo());
    expect(current?.doc).toEqual(last);
  });

  test("flushes the last dirty doc on unmount and cancels the timer", () => {
    act(() => current?.schedulePersist(last));
    act(() => root.unmount());
    current = undefined;
    expect(persistCanvasDoc).toHaveBeenCalledTimes(1);
    expect(persistCanvasDoc).toHaveBeenLastCalledWith("canvas", last);
    act(() => {
      vi.runAllTimers();
    });
    expect(persistCanvasDoc).toHaveBeenCalledTimes(1);
  });

  test("an idle hook does not persist on unmount", () => {
    expect(current?.doc).toEqual(empty);
    act(() => root.unmount());
    current = undefined;
    expect(persistCanvasDoc).not.toHaveBeenCalled();
  });
});
