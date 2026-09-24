/**
 * The lab through the real App: off by default, so `/lab` is the outline's
 * like any unmatched path and the sidebar has no Lab row; switched on in the
 * preference, the row appears and `/lab` mounts a study; switched off again,
 * both leave live — no reload — and the mounted study is disposed.
 *
 * The study's scene is a stand-in: happy-dom has no GPU, and what is under
 * test is the plugin's life cycle, not three.js.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@kb/contracts";
import type { LabScene } from "@/components/lab/kit/contract";

const scene = vi.hoisted(() => ({ mounted: 0, disposed: 0 }));

vi.mock("@/components/lab/embers/scene", () => ({
  mountEmbers: (): Promise<LabScene> => {
    scene.mounted += 1;
    return Promise.resolve({
      backend: "WebGL2",
      setPalette: () => {},
      setReducedMotion: () => {},
      setControl: () => {},
      resize: () => {},
      setRunning: () => {},
      dispose: () => {
        scene.disposed += 1;
      },
    });
  },
}));

const { App } = await import("@/components/App");
const { setFetchGraphSnapshot } = await import("@/api/graph");
const { navigate } = await import("@/lib/router");
const { usePrefsStore } = await import("@/stores/prefs.store");

const ISO = "2026-09-24T00:00:00.000Z";

function snapshot(): GraphSnapshot {
  return {
    rev: 1,
    nodes: [{ id: "n.a", text: "a note", props: {}, children: [], createdAt: ISO, updatedAt: ISO }],
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Settle until `ready` holds, or give up after a few seconds of real time. */
async function until(ready: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("lab plugin (acceptance)", () => {
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
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    g.ResizeObserver = class {
      observe(): void {}
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
    act(() => usePrefsStore.getState().setPluginEnabled("lab", false));
    dom.history.pushState({}, "", "/");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await settle();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const labRow = () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Lab");
  const study = () => container.querySelector("[data-lab-study]");

  it("is off by default: no sidebar row, and /lab falls through to the outline", async () => {
    expect(usePrefsStore.getState().enabledPlugins).toEqual([]);
    expect(labRow()).toBeUndefined();
    await act(async () => navigate("/lab"));
    await settle();
    expect(study()).toBeNull();
    expect(container.textContent).toContain("a note");
  });

  it("switched on, contributes its row and page; switched off, both leave live", async () => {
    await act(async () => usePrefsStore.getState().setPluginEnabled("lab", true));
    await settle();
    expect(labRow()).toBeDefined();

    await act(async () => navigate("/lab"));
    // The page is a lazy chunk: wait for it (and the scene it mounts) to arrive.
    await until(() => scene.mounted > 0);
    expect(study()?.getAttribute("data-lab-study")).toBe("embers");
    expect(scene.mounted).toBe(1);

    await act(async () => usePrefsStore.getState().setPluginEnabled("lab", false));
    await settle();
    expect(labRow()).toBeUndefined();
    expect(study()).toBeNull();
    expect(container.textContent).toContain("a note");
    // Unloading tore the page down, and the page gave its scene back.
    expect(scene.disposed).toBe(1);
  });
});
