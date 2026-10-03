/**
 * Panes and layouts through the real App (DESIGN-UI.md → Panes and layouts):
 * Shift-clicking a bullet opens its node in a pane beside, the URL names the
 * focused pane, a pane closes, a saved layout opens as the workspace, and a
 * layout that contains itself stops at the first repeat instead of drawing
 * forever.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GraphSnapshot, WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { LayoutView, layoutPanes, type LayoutTree } from "@kb/views";

const { App } = await import("@/components/App");
const { setFetchGraphSnapshot } = await import("@/api/graph");
const { getPath, navigate } = await import("@/lib/router");
const { useWorkspaceStore, WORKSPACE_STORAGE_KEY } = await import("@/stores/workspace.store");

const ISO = "2026-10-03T00:00:00.000Z";

function node(id: string, text: string, extra: Partial<WireNode> = {}): WireNode {
  return { id, text, props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...extra };
}

function layoutNode(id: string, root: LayoutTree): WireNode {
  return node(id, "Self", {
    props: {
      [SYSTEM_IDS.viewField]: [{ t: "ref", v: LayoutView.option }],
      [SYSTEM_IDS.layoutField]: [{ t: "str", v: JSON.stringify(root) }],
    },
  });
}

function snapshot(): GraphSnapshot {
  return {
    rev: 1,
    nodes: [
      node("n.a", "a project", { children: ["n.b"] }),
      node("n.b", "a task", { parentId: "n.a" } as Partial<WireNode>),
      layoutNode("v.self", {
        split: "row",
        children: [
          { tabs: [{ id: "a", path: "/node/n.b" }] },
          { tabs: [{ id: "b", path: "/node/v.self" }] },
        ],
      }),
      layoutNode("v.one", { tabs: [{ id: "only", path: "/node/v.one" }] }),
    ],
  };
}

async function until(ready: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("panes (acceptance)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window({ url: "http://localhost/" });
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.PointerEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.getComputedStyle = dom.getComputedStyle.bind(dom);
    // The layout grid (dockview) schedules its layout on animation frames.
    g.requestAnimationFrame = (run: () => void) => setTimeout(run, 0);
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    g.WebSocket = class {
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    };
    setFetchGraphSnapshot(() => Promise.resolve(snapshot()));
  });

  afterAll(() => setFetchGraphSnapshot(null));

  beforeEach(async () => {
    dom.history.pushState({}, "", "/");
    useWorkspaceStore.setState({ layout: { tabs: [{ id: "main", path: "/" }] }, focused: "main" });
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await until(() => container.textContent.includes("a project"));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const panes = () => layoutPanes(useWorkspaceStore.getState().layout);
  const paneBody = (id: string) => container.querySelector(`[data-pane="${id}"]`);

  it("Shift-clicking a bullet opens its node in a pane beside, which the URL then names", async () => {
    const row = container.querySelector('[data-node-id="n.a"]');
    const bullet = row?.querySelector("button");
    if (bullet === null || bullet === undefined) throw new Error("no bullet for n.a");
    await act(async () => {
      bullet.dispatchEvent(new dom.MouseEvent("click", { bubbles: true, shiftKey: true }) as never);
    });
    expect(panes().map((pane) => pane.path)).toEqual(["/", "/node/n.a"]);
    const opened = panes()[1]?.id ?? "";
    expect(useWorkspaceStore.getState().focused).toBe(opened);
    expect(getPath()).toBe("/node/n.a");
    // Kept per device.
    expect(dom.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toContain("/node/n.a");
    // The new pane shows the node's outline: its child, under the pane's own rows.
    await until(() => paneBody(opened)?.textContent.includes("a task") === true);
    expect(paneBody(opened)?.textContent).toContain("a task");
    expect(
      paneBody(opened)?.querySelector(`[data-instance-key^="pane:${opened}/"]`),
    ).not.toBeNull();

    // Focusing the first pane names it in the URL, without a history step.
    await act(async () => useWorkspaceStore.getState().focus("main"));
    expect(getPath()).toBe("/");
    // A navigation moves the focused pane only.
    await act(async () => navigate("/node/n.b"));
    expect(panes().map((pane) => pane.path)).toEqual(["/node/n.b", "/node/n.a"]);

    await act(async () => useWorkspaceStore.getState().close(opened));
    expect(panes()).toEqual([{ id: "main", path: "/node/n.b" }]);
  });

  it("a layout that contains itself stops at the first repeat", async () => {
    await act(async () => navigate("/node/v.self"));
    await until(() => container.textContent.includes("This view cannot be shown here"));
    expect(container.textContent).toContain("This view cannot be shown here");
    expect(container.querySelectorAll('[data-layout-view="dashboard"]')).toHaveLength(1);
    // Its other pane draws: the task.
    expect(container.textContent).toContain("a task");
  });

  it("a saved layout opens as the workspace", async () => {
    await act(async () => navigate("/node/v.one"));
    await until(() => container.querySelector('[aria-label="Open as the workspace"]') !== null);
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open as the workspace"]',
    );
    await act(async () => button?.click());
    expect(panes()).toEqual([{ id: "only", path: "/node/v.one" }]);
    expect(useWorkspaceStore.getState().focused).toBe("only");
    expect(getPath()).toBe("/node/v.one");
  });
});
