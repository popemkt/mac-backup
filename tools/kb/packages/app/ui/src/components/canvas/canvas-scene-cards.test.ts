/**
 * When the 3D canvas repaints a card's face: only when what the face shows
 * changes, and after a resize once sizes hold still (the face is stretched
 * meanwhile). A paint is a 2D context asked of a face canvas.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import type { CanvasDoc, CanvasNode } from "@kb/canvas";
import { fakeCanvasContexts } from "@/test-support/fake-gpu";
import type { CardLook } from "./canvas-card-face";
import { CardLayer } from "./canvas-scene-cards";

const look: CardLook = {
  face: "rgb(255, 255, 255)",
  ink: "rgb(20, 20, 20)",
  primary: "rgb(190, 120, 20)",
  danger: "rgb(200, 30, 30)",
  presets: {},
  font: "sans-serif",
  body: 14.5,
  ui: 13,
  label: 11,
  radius: 18,
  shapeRadius: 8,
};

const a: CanvasNode = { id: "a", type: "text", text: "one", x: 0, y: 0, width: 200, height: 80 };
const b: CanvasNode = { id: "b", type: "text", text: "two", x: 300, y: 0, width: 200, height: 80 };
const content = (nodes: CanvasNode[]) => ({
  doc: { nodes, edges: [] } satisfies CanvasDoc,
  nodes: new Map(),
  selection: { nodeIds: new Set<string>(), edgeIds: new Set<string>() },
});

describe("card faces", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  let contexts: { mock: { calls: unknown[] }; mockClear: () => void } | null = null;
  const paints = () => contexts?.mock.calls.length ?? 0;
  const resetPaints = () => contexts?.mockClear();

  beforeAll(() => {
    const dom = new Window();
    const globals = {
      window: dom,
      document: dom.document,
      getComputedStyle: dom.getComputedStyle.bind(dom),
    };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
    fakeCanvasContexts(dom.HTMLCanvasElement.prototype);
    contexts = vi.spyOn(dom.HTMLCanvasElement.prototype, "getContext");
  });

  afterAll(() => {
    for (const [key, value] of saved) g[key] = value;
  });

  afterEach(() => vi.useRealTimers());

  test("a face is painted once, and again only when what it shows changes", () => {
    const layer = new CardLayer(look, false, () => {});
    resetPaints();
    layer.sync(content([a, b]));
    expect(paints()).toBe(2);
    layer.sync(content([{ ...a, x: 40 }, b]));
    expect(paints()).toBe(2);
    layer.sync(content([{ ...a, x: 40, text: "changed" }, b]));
    expect(paints()).toBe(3);
    layer.dispose();
  });

  test("a resize stretches the face, then repaints it once sizes hold still", () => {
    vi.useFakeTimers();
    const wake = vi.fn();
    const layer = new CardLayer(look, false, wake);
    layer.sync(content([a, b]));
    resetPaints();
    for (const width of [220, 240, 260]) layer.sync(content([{ ...a, width }, b]));
    expect(paints()).toBe(0);
    vi.advanceTimersByTime(200);
    expect(paints()).toBe(1);
    expect(wake).toHaveBeenCalledTimes(1);
    layer.dispose();
  });
});
