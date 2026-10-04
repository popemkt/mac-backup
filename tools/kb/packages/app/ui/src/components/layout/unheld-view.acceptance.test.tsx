/**
 * A view the server lists that no plugin on the page holds, through the real
 * App: the lab, which the server always loads, with the page's lab switched
 * off as it is by default. A lab view node (synced from another machine, or
 * proposed by an agent against the server's list) is a node that exists, so
 * it opens as the "cannot be shown here" state naming the view by the
 * server's label, never as a node that is not found; and the pane switcher
 * names it "Lab", not by its id.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GraphSnapshot, WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import { LabView } from "@kb/lab";
import { viewCatalogOf } from "@kb/views";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";

const { App } = await import("@/components/App");
const { PaneSwitcher } = await import("@/components/layout/pane-switcher");
const { setFetchGraphSnapshot } = await import("@/api/graph");
const { setPostAction } = await import("@/api/action");
const { navigate } = await import("@/lib/router");
const { pageCatalog } = await import("@/lib/view-catalog");
const { usePrefsStore } = await import("@/stores/prefs.store");

const ISO = "2026-10-04T00:00:00.000Z";

/** What a server running every bundled family lists in `kb.manifest`: the lab included. */
const SERVED = viewCatalogOf(
  BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.views ?? []),
).entries();

function node(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return { id, text, props, children: [], createdAt: ISO, updatedAt: ISO };
}

function snapshot(): GraphSnapshot {
  return {
    rev: 1,
    nodes: [
      node("n.host", "Studies", {
        [SYSTEM_IDS.viewsField]: [{ t: "ref", v: "v.lab" }],
      }),
      // Untitled, so what names it is its view.
      node("v.lab", "", { [SYSTEM_IDS.viewField]: [{ t: "ref", v: LabView.option }] }),
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

describe("a view the server lists that the page does not hold (acceptance)", () => {
  let dom: InstalledDom;
  let container: HTMLElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    const g = globalThis as Record<string, unknown>;
    g.PointerEvent = dom.window.MouseEvent;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
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
    // The server lists every bundled family's views; it answers nothing else.
    setPostAction(async (invocation) =>
      invocation.id === "kb.manifest"
        ? { status: "succeeded", id: invocation.id, output: { actions: [], views: SERVED }, rev: 1 }
        : { status: "failed", id: invocation.id, code: "unknown_action", message: "none", rev: 1 },
    );
  });

  afterAll(() => {
    setFetchGraphSnapshot(null);
    setPostAction(null);
    dom.restore();
  });

  beforeEach(async () => {
    act(() => usePrefsStore.setState({ enabledPlugins: [] }));
    dom.window.history.pushState({}, "", "/");
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    // The page's catalog follows the server's once its manifest arrives.
    await until(() => pageCatalog().listedOf(LabView.option) !== null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("holds no lab key with the lab off, and lists the lab by the server's entry", () => {
    expect(usePrefsStore.getState().enabledPlugins).toEqual([]);
    expect(pageCatalog().keyOf(LabView.option)).toBeNull();
    expect(pageCatalog().listedOf(LabView.option)?.label).toBe("Lab");
  });

  it("opens a lab view node as the view it cannot show here, named Lab", async () => {
    await act(async () => navigate("/node/n.host/v.lab"));
    await until(() => container.textContent.includes("This view cannot be shown here"));
    expect(container.textContent).toContain("This view cannot be shown here");
    expect(container.textContent).toContain("Lab: its plugin is not loaded");
    expect(container.querySelector('[data-not-found="Node"]')).toBeNull();
  });

  it("names the lab view node Lab in the pane switcher", async () => {
    const menuRoot = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(menuRoot as unknown as never);
    const switcher = createRoot(menuRoot);
    await act(async () => {
      switcher.render(
        <PaneSwitcher path="/node/n.host/v.lab" title="Studies" onChoose={() => {}} />,
      );
    });
    const button = menuRoot.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    await act(async () => button?.click());
    const menu = dom.window.document.querySelector('[role="menu"][aria-label="Show in this pane"]');
    const labels = [...(menu?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((item) =>
      item.textContent.trim(),
    );
    expect(labels).toContain("Lab");
    expect(labels).not.toContain("v.lab");
    act(() => switcher.unmount());
    menuRoot.remove();
  });
});
