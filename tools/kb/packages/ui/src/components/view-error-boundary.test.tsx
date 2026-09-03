import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ViewError, ViewErrorBoundary } from "@/components/view-error-boundary";

function Boom({ fail }: { fail: boolean }): ReactElement {
  if (fail) throw new Error("webgl kaboom");
  return createElement("div", { "data-testid": "ok" }, "ok");
}

function Shell({ children }: { children: ReactNode }): ReactElement {
  return createElement(
    "div",
    { "data-testid": "shell-chrome" },
    createElement("header", null, "kb chrome"),
    createElement("main", null, children),
  );
}

describe("ViewErrorBoundary", () => {
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
    g.Node = dom.Node as unknown;
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
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders children when healthy", () => {
    act(() => {
      root.render(
        createElement(ViewErrorBoundary, { children: createElement(Boom, { fail: false }) }),
      );
    });
    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="view-error"]')).toBeNull();
  });

  it("contains a crash inside the view while shell chrome stays mounted", () => {
    act(() => {
      root.render(
        createElement(Shell, {
          children: createElement(ViewErrorBoundary, {
            title: "Graph crashed",
            children: createElement(Boom, { fail: true }),
          }),
        }),
      );
    });
    expect(container.querySelector('[data-testid="shell-chrome"]')).not.toBeNull();
    expect(container.textContent).toContain("kb chrome");
    expect(container.querySelector('[data-testid="view-error"]')).not.toBeNull();
    expect(container.textContent).toContain("Graph crashed");
    expect(container.textContent).toContain("webgl kaboom");
  });

  it("resetKey recovers after the child stops throwing", () => {
    function Controlled({ failProp }: { failProp: boolean }): ReactElement {
      return createElement(ViewErrorBoundary, {
        title: "Canvas crashed",
        resetKey: failProp ? "bad" : "good",
        children: createElement(Boom, { fail: failProp }),
      });
    }

    act(() => {
      root.render(createElement(Controlled, { failProp: true }));
    });
    expect(container.querySelector('[data-testid="view-error"]')).not.toBeNull();

    act(() => {
      root.render(createElement(Controlled, { failProp: false }));
    });
    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="view-error"]')).toBeNull();
  });

  it("ViewError retry button invokes onRetry", () => {
    let clicked = false;
    act(() => {
      root.render(
        createElement(ViewError, {
          title: "Canvas crashed",
          onRetry: () => {
            clicked = true;
          },
        }),
      );
    });
    const btn = container.querySelector('[data-testid="view-error-retry"]') as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(clicked).toBe(true);
  });
});
