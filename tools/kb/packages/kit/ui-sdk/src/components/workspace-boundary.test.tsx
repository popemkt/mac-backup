import { present } from "@kb/model";
import { act, lazy } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceBoundary } from "./workspace-boundary";

describe("workspace readiness", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("makes ready content available immediately and preserves an in-progress edit on updates", () => {
    act(() =>
      root.render(
        <WorkspaceBoundary pending title="Opening workspace…">
          <input aria-label="Node text" defaultValue="An idea" />
        </WorkspaceBoundary>,
      ),
    );
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Opening workspace");

    act(() =>
      root.render(
        <WorkspaceBoundary title="Opening workspace…">
          <input aria-label="Node text" defaultValue="An idea" />
        </WorkspaceBoundary>,
      ),
    );
    const input = present(container.querySelector("input"), "ready input");
    expect(input).toBeTruthy();
    expect(container.querySelector('[role="status"]')).toBeNull();
    input.value = "My unfinished edit";
    input.focus();

    act(() =>
      root.render(
        <WorkspaceBoundary title="Opening another view…">
          <input aria-label="Node text" defaultValue="An idea" />
        </WorkspaceBoundary>,
      ),
    );
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("My unfinished edit");
    expect(dom.document.activeElement).toBe(input);
  });

  it("uses one loading surface across data readiness and a lazy module, with no artificial wait", async () => {
    const { promise: module, resolve: resolveModule } = Promise.withResolvers<{
      default: () => React.ReactNode;
    }>();
    const LazyView = lazy(() => module);
    await act(async () =>
      root.render(
        <WorkspaceBoundary pending title="Opening graph…">
          <LazyView />
        </WorkspaceBoundary>,
      ),
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    await act(async () =>
      root.render(
        <WorkspaceBoundary title="Opening graph…">
          <LazyView />
        </WorkspaceBoundary>,
      ),
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector("button")).toBeNull();

    await act(async () => {
      resolveModule({ default: () => <button type="button">Select a node</button> });
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("Select a node");
  });
});
