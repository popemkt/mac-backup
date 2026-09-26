/**
 * GraphPage smoke: hydrated store renders header + canvas mount.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import type * as GraphAdapters from "./graph-adapters";

vi.mock("sigma", () => ({ default: class {} }));
vi.mock("sigma/rendering", () => ({ EdgeArrowProgram: class {} }));
vi.mock("@/components/graph/sigma-graph", () => ({
  SigmaGraph: (props: { nodes: unknown[]; edges: unknown[] }) =>
    createElement("div", {
      "data-testid": "sigma-graph",
      "data-node-count": props.nodes.length,
      "data-edge-count": props.edges.length,
    }),
}));
vi.mock("@/components/graph/graph-toolbar", () => ({
  GraphToolbar: () => createElement("div", { "data-testid": "graph-toolbar" }),
}));
vi.mock("@/components/graph/graph-legend", () => ({
  GraphLegend: () => createElement("div", { "data-testid": "graph-legend" }),
}));
vi.mock("@/components/graph/cluster-graph", () => ({
  ClusterGraph: () => createElement("div", { "data-testid": "cluster-graph" }),
}));
vi.mock("@/components/graph/tree-graph", () => ({
  TreeGraph: () => createElement("div", { "data-testid": "tree-graph" }),
}));
vi.mock("@/components/graph/force3d-graph", () => ({
  default: () => createElement("div", { "data-testid": "force3d-graph" }),
}));

/** Every (view key, node count) pair a renderer was handed, in order. */
const handed = vi.hoisted(() => [] as { viewKey: string; nodes: number }[]);
vi.mock("./graph-adapters", async (importOriginal) => {
  const real = await importOriginal<typeof GraphAdapters>();
  return {
    ...real,
    Force2dAdapter: (props: Parameters<typeof real.Force2dAdapter>[0]) => {
      handed.push({ viewKey: props.viewKey, nodes: props.lensGraph.nodes.length });
      return real.Force2dAdapter(props);
    },
  };
});

import GraphPage from "./graph-page";

/**
 * Let the page settle: lazy renderer chunks resolve and effects commit, each
 * step inside `act`, until `ready` holds. A condition that never holds fails
 * with the reason, rather than a fixed sleep passing or failing by timing.
 */
async function settle(ready: () => boolean, reason: string): Promise<void> {
  for (let i = 0; i < 100 && !ready(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  if (!ready()) throw new Error(`the graph page never settled: ${reason}`);
}

function seed() {
  resetOutlineStore();
  useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

describe("GraphPage (smoke)", () => {
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
    g.PointerEvent = dom.PointerEvent;
    g.requestAnimationFrame = (cb: FrameRequestCallback) => Number(dom.setTimeout(() => cb(0), 0));
    g.cancelAnimationFrame = (id: number) => {
      dom.clearTimeout(id as unknown as ReturnType<typeof dom.setTimeout>);
    };
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    seed();
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders header + canvas after hydrate", async () => {
    await act(async () => {
      root.render(
        createElement(GraphPage, {
          perspectiveId: SYSTEM_IDS.lensAllMentions,
        }),
      );
    });
    await settle(
      () => container.querySelector('[data-testid="sigma-graph"]') !== null,
      "no 2D canvas mounted",
    );

    expect(container.textContent).toContain("graph");
    expect(container.textContent).toContain("All mentions");
    expect(container.textContent).toMatch(/\d+ nodes/);
    expect(container.querySelector('[data-renderer-switch="true"]')).not.toBeNull();
    const canvas = present(container.querySelector('[data-testid="sigma-graph"]'), "sigma graph");
    expect(Number(canvas.getAttribute("data-node-count"))).toBeGreaterThan(0);
  });

  it("reports a max-nodes cap in the header, not over the canvas chrome", async () => {
    resetOutlineStore();
    const capped = fixtureGraph.nodes.map((node) =>
      node.id === SYSTEM_IDS.lensAllMentions
        ? {
            ...node,
            props: { ...node.props, [SYSTEM_IDS.lensMaxNodesField]: [{ t: "num" as const, v: 2 }] },
          }
        : node,
    );
    useOutlineStore.getState().hydrateFromWire(capped, fixtureGraph.rev, "fixtures");
    await act(async () => {
      root.render(createElement(GraphPage, { perspectiveId: SYSTEM_IDS.lensAllMentions }));
    });
    await settle(
      () => /top 2 of \d+ nodes/.test(container.querySelector("header")?.textContent ?? ""),
      "no capped header",
    );

    const header = present(container.querySelector("header"), "graph header");
    expect(header.textContent).toMatch(/top 2 of \d+ nodes by degree/);
    const edit = [...header.querySelectorAll("button")].find(
      (button) => button.textContent === "edit max-nodes",
    );
    expect(edit).toBeDefined();
    const canvas = present(container.querySelector('[data-testid="sigma-graph"]'), "sigma graph");
    expect(Number(canvas.getAttribute("data-node-count"))).toBe(2);
  });

  it("hands a renderer a view key and the node set extracted for it, never the next view's key early", async () => {
    handed.length = 0;
    await act(async () => {
      root.render(createElement(GraphPage, { perspectiveId: SYSTEM_IDS.lensAllMentions }));
      await new Promise((r) => setTimeout(r, 350));
    });
    const before = handed.at(-1);
    const toggle = present(container.querySelector("[data-elide-toggle]"), "sys toggle");
    // The sys switch changes the view at once; its node set lands after the debounce.
    await act(async () => {
      toggle.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }) as unknown as MouseEvent);
      await Promise.resolve();
    });
    expect(handed.at(-1)?.viewKey).toBe(before?.viewKey);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    const after = handed.at(-1);
    expect(after?.viewKey).not.toBe(before?.viewKey);
    // One key, one node set: no render paired a key with another view's nodes.
    const counts = new Map<string, Set<number>>();
    for (const { viewKey, nodes } of handed)
      counts.set(viewKey, (counts.get(viewKey) ?? new Set()).add(nodes));
    for (const set of counts.values()) expect(set.size).toBe(1);
  });
});
