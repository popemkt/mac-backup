/**
 * In-canvas error boundary: renderer throw stays inside the frame.
 */
import { act, Component, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GraphCanvasError, GraphCanvasErrorBoundary } from "./graph-canvas-error";

class Boom extends Component<{ blow: boolean; children?: ReactNode }> {
  override render(): ReactNode {
    if (this.props.blow) throw new Error("simulated renderer failure");
    return createElement("div", { "data-testid": "ok" }, "ok");
  }
}

describe("GraphCanvasErrorBoundary", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: typeof console.error;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom as unknown;
    g.document = dom.document as unknown;
    g.HTMLElement = dom.HTMLElement as unknown;
  });

  beforeEach(() => {
    consoleError = console.error;
    console.error = () => {};
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    console.error = consoleError;
    act(() => root.unmount());
    (container as unknown as { remove(): void }).remove();
  });

  it("draws the error message inside the canvas frame", () => {
    act(() => {
      root.render(
        createElement(GraphCanvasErrorBoundary, {
          resetKey: "a",
          children: createElement(Boom, { blow: true }),
        }),
      );
    });
    const alert = container.querySelector('[data-testid="graph-canvas-error"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain("simulated renderer failure");
    expect(container.querySelector('[data-testid="ok"]')).toBeNull();
  });

  it("recovers when resetKey changes", () => {
    act(() => {
      root.render(
        createElement(GraphCanvasErrorBoundary, {
          resetKey: "a",
          children: createElement(Boom, { blow: true }),
        }),
      );
    });
    expect(container.querySelector('[data-testid="graph-canvas-error"]')).toBeTruthy();
    act(() => {
      root.render(
        createElement(GraphCanvasErrorBoundary, {
          resetKey: "b",
          children: createElement(Boom, { blow: false }),
        }),
      );
    });
    expect(container.querySelector('[data-testid="ok"]')).toBeTruthy();
  });

  it("GraphCanvasError exposes retry", () => {
    let retried = false;
    act(() => {
      root.render(
        createElement(GraphCanvasError, {
          message: "boom",
          onRetry: () => {
            retried = true;
          },
        }),
      );
    });
    const btn = container.querySelector(
      '[data-testid="graph-canvas-error-retry"]',
    ) as HTMLButtonElement;
    act(() => btn.click());
    expect(retried).toBe(true);
  });
});
