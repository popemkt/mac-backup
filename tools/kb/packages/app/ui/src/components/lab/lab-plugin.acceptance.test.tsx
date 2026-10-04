/**
 * The lab through the real App, switched on the server: the page draws an
 * extension's UI exactly when the server's `kb.manifest` reports the
 * extension loaded. Off by default, the server does not load it, so `/lab`
 * is not found like any unmatched path and the sidebar has no Lab row.
 * Switched on from Preferences, the row asks the server (`extension.switch`),
 * the server loads the lab and reports it, and the row and `/lab` appear;
 * switched off again, both leave live — no reload — and the mounted study is
 * disposed. Nothing is kept in the browser's preferences.
 *
 * The server is a stand-in that answers the manifest from one switch. The
 * study's scene is a stand-in too: happy-dom has no GPU, and what is under
 * test is the plugin's life cycle, not three.js.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_DECLARATIONS, BUNDLED_FAMILIES } from "@kb/bundled";
import { extensionRow, type ActionInvocation, type GraphSnapshot } from "@kb/contracts";
import { viewCatalogOf } from "@kb/views";
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
const { setPostAction } = await import("@/api/action");
const { navigate } = await import("@/lib/router");
const { servedManifest } = await import("@/lib/manifest");
const { useUiStore } = await import("@/stores/ui.store");

const ISO = "2026-09-24T00:00:00.000Z";

function snapshot(): GraphSnapshot {
  return {
    rev: 1,
    nodes: [{ id: "n.a", text: "a note", props: {}, children: [], createdAt: ISO, updatedAt: ISO }],
  };
}

/** The server: every bundled family loaded, the lab only while it is switched on. */
const server = { lab: false, switches: [] as unknown[] };

function loaded(name: string): boolean {
  return name !== "lab" || server.lab;
}

function manifest() {
  return {
    actions: [],
    views: viewCatalogOf(
      BUNDLED_DECLARATIONS.filter(({ name }) => loaded(name)).flatMap(({ views }) => views ?? []),
    ).entries(),
    extensions: BUNDLED_FAMILIES.map((declaration) =>
      extensionRow(declaration, "bundled", loaded(declaration.name)),
    ),
  };
}

async function answer(invocation: ActionInvocation) {
  if (invocation.id === "kb.manifest") {
    return { status: "succeeded" as const, id: invocation.id, output: manifest(), rev: 1 };
  }
  if (invocation.id === "extension.switch") {
    server.switches.push(invocation.input);
    const { on } = invocation.input as { name: string; on: boolean };
    server.lab = on;
    return { status: "succeeded" as const, id: invocation.id, output: invocation.input, rev: 1 };
  }
  return {
    status: "failed" as const,
    id: invocation.id,
    code: "unknown_action" as const,
    message: "none",
    rev: 1,
  };
}

/** What the page last heard the server say of the lab. */
function reportedLab(): boolean | undefined {
  return servedManifest()?.extensions.find(({ name }) => name === "lab")?.enabled;
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

describe("lab plugin, switched on the server (acceptance)", () => {
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
    setPostAction(answer);
  });

  afterAll(() => {
    setFetchGraphSnapshot(null);
    setPostAction(null);
  });

  /** Render the App over the server as it is, and wait until the page has heard it. */
  async function boot(): Promise<void> {
    dom.history.pushState({}, "", "/");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await until(() => reportedLab() === server.lab);
    await settle();
  }

  beforeEach(() => {
    server.lab = false;
    server.switches = [];
  });

  afterEach(() => {
    act(() => useUiStore.getState().setPrefsOpen(false));
    act(() => root.unmount());
    container.remove();
  });

  const labRow = () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Lab");
  const study = () => container.querySelector("[data-lab-study]");
  const notFound = () => container.querySelector('[data-not-found="Page"]');
  const labSwitch = () =>
    container.querySelector<HTMLSelectElement>('[data-testid="plugin-lab"]') ?? null;

  /** Choose `value` on the lab's Preferences row. */
  async function choose(value: "on" | "off"): Promise<void> {
    act(() => useUiStore.getState().setPrefsOpen(true));
    const select = labSwitch();
    expect(select).not.toBeNull();
    await act(async () => {
      if (select === null) return;
      select.value = value;
      select.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
    });
  }

  it("is off while the server has it off: no row, /lab not found, and its switch shows off", async () => {
    await boot();
    expect(reportedLab()).toBe(false);
    expect(labRow()).toBeUndefined();
    act(() => useUiStore.getState().setPrefsOpen(true));
    expect(labSwitch()?.value).toBe("off");
    await act(async () => navigate("/lab"));
    await settle();
    expect(study()).toBeNull();
    expect(notFound()).not.toBeNull();
  });

  it("is drawn from the start when the server reports it loaded", async () => {
    server.lab = true;
    await boot();
    await until(() => labRow() !== undefined);
    expect(labRow()).toBeDefined();
  });

  it("switched on from Preferences, the server loads it and the page follows; switched off, both leave live", async () => {
    await boot();
    await choose("on");
    expect(server.switches).toEqual([{ name: "lab", on: true }]);
    // The page asked the server, heard it back, and loaded the lab's chunk.
    await until(() => labRow() !== undefined);
    expect(reportedLab()).toBe(true);
    expect(labRow()).toBeDefined();
    expect(labSwitch()?.value).toBe("on");

    act(() => useUiStore.getState().setPrefsOpen(false));
    await act(async () => navigate("/lab"));
    // The page is a lazy chunk: wait for it (and the scene it mounts) to arrive.
    await until(() => scene.mounted > 0);
    expect(study()?.getAttribute("data-lab-study")).toBe("embers");
    expect(scene.mounted).toBe(1);

    await choose("off");
    expect(server.switches).toEqual([
      { name: "lab", on: true },
      { name: "lab", on: false },
    ]);
    await until(() => labRow() === undefined);
    expect(reportedLab()).toBe(false);
    expect(labRow()).toBeUndefined();
    expect(study()).toBeNull();
    expect(notFound()).not.toBeNull();
    // Unloading tore the page down, and the page gave its scene back.
    expect(scene.disposed).toBe(1);
  });
});
