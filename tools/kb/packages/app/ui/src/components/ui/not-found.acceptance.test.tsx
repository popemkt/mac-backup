/**
 * Not-found is one component, for every route (closing audit P2-4). Before,
 * `/canvas/NOPE` printed bare red text, `/o/NOPE` drew an empty state under an
 * "Untitled ontology · 0 members" scope bar, `/graph/NOPE` quietly showed the
 * default perspective, and `/nope/xyz` or `/lab/nope` showed the outline under
 * the wrong URL. Each case below goes through the real App.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@kb/contracts";

const { App } = await import("@/components/App");
const { setFetchGraphSnapshot } = await import("@/api/graph");
const { navigate } = await import("@/lib/router");

const ISO = "2026-09-24T00:00:00.000Z";

function snapshot(): GraphSnapshot {
  return {
    rev: 1,
    nodes: [{ id: "n.a", text: "a note", props: {}, children: [], createdAt: ISO, updatedAt: ISO }],
  };
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

const CASES: readonly { path: string; what: string }[] = [
  { path: "/nope/xyz", what: "Page" },
  { path: "/lab/nope", what: "Page" },
  { path: "/canvas/NOPE", what: "Canvas" },
  { path: "/o/NOPE", what: "Ontology" },
  { path: "/o/NOPE/outline", what: "Ontology" },
  { path: "/graph/NOPE", what: "Graph perspective" },
];

describe("not found, on every route (acceptance)", () => {
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
    dom.history.pushState({}, "", "/");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await until(() => container.textContent.includes("a note"));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(CASES)("$path shows the one NotFound ($what), with no chrome of it", async (c) => {
    await act(async () => navigate(c.path));
    const found = () => container.querySelector(`[data-not-found="${c.what}"]`);
    await until(() => found() !== null);
    expect(found()).not.toBeNull();
    expect(container.querySelectorAll("[data-not-found]")).toHaveLength(1);
    expect(container.querySelector("[data-ontology-scope-bar]")).toBeNull();
    expect(container.textContent).not.toContain("a note");
  });

  it("the outline still owns /", () => {
    expect(container.querySelector("[data-not-found]")).toBeNull();
    expect(container.textContent).toContain("a note");
  });
});
