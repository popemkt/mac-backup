/**
 * Below 768px the sidebar floats over the page (closing audit P2-7). A
 * docked-open preference from a wide screen does not carry over: on a narrow
 * viewport the sidebar opens only when asked, and its scrim closes it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { Sidebar } from "./sidebar";

let narrow = false;

describe("sidebar on a narrow viewport (component)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window({ url: "http://localhost/" });
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.Node = dom.Node;
    (dom as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: narrow,
      addEventListener() {},
      removeEventListener() {},
    });
  });

  beforeEach(() => {
    usePrefsStore.setState({ sidebarOpen: true });
    useUiStore.setState({ sidebarOverlayOpen: false });
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const aside = () => container.querySelector("aside");
  const scrim = () => container.querySelector<HTMLButtonElement>("[data-sidebar-scrim]");

  it("wide: docks open from the preference, with no scrim", () => {
    narrow = false;
    act(() => root.render(createElement(Sidebar)));
    expect(aside()?.getAttribute("aria-hidden")).toBe("false");
    expect(scrim()).toBeNull();
  });

  it("narrow: starts closed whatever the preference, opens on request, closes from its scrim", () => {
    narrow = true;
    act(() => root.render(createElement(Sidebar)));
    expect(aside()?.getAttribute("aria-hidden")).toBe("true");

    act(() => useUiStore.getState().setSidebarOverlayOpen(true));
    expect(aside()?.getAttribute("aria-hidden")).toBe("false");
    expect(aside()?.className).toContain("max-md:fixed");

    act(() => scrim()?.click());
    expect(aside()?.getAttribute("aria-hidden")).toBe("true");
    expect(usePrefsStore.getState().sidebarOpen).toBe(true);
  });
});
