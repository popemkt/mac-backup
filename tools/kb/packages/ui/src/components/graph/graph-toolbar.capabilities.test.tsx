/**
 * Toolbar must disable unsupported controls with a reason — never look live and no-op.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphToolbar } from "./graph-toolbar";
import { RENDERER_CAPABILITIES } from "./graph-capabilities";
import type { GraphCameraControls } from "./graph-camera-controls";

describe("GraphToolbar capabilities", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.Node = dom.Node;
  });

  beforeEach(() => {
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    (container as unknown as { remove(): void }).remove();
  });

  it("disables zoom buttons for tree when zoom is claimed false", () => {
    const controls: GraphCameraControls = {
      fit: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      reset: vi.fn(),
      focusNode: vi.fn(),
    };
    const caps = { ...RENDERER_CAPABILITIES.tree!, zoom: false };
    act(() => {
      root.render(
        createElement(GraphToolbar, {
          capabilities: caps,
          controls,
          selectedNodeId: null,
          nodes: [{ id: "a", label: "A" }],
        }),
      );
    });
    const zoomIn = container.querySelector(
      'button[aria-label="Zoom is not available in this renderer"]',
    );
    expect(zoomIn).toBeTruthy();
    expect((zoomIn as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      (zoomIn as HTMLButtonElement).click();
    });
    expect(controls.zoomIn).not.toHaveBeenCalled();
  });

  it("invokes fit when capability is enabled", () => {
    const controls: GraphCameraControls = {
      fit: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      reset: vi.fn(),
      focusNode: vi.fn(),
    };
    act(() => {
      root.render(
        createElement(GraphToolbar, {
          capabilities: RENDERER_CAPABILITIES.force2d!,
          controls,
          selectedNodeId: null,
          nodes: [],
        }),
      );
    });
    const fit = container.querySelector('button[aria-label="Fit view (f)"]') as HTMLButtonElement;
    expect(fit.disabled).toBe(false);
    act(() => fit.click());
    expect(controls.fit).toHaveBeenCalledTimes(1);
  });
});
