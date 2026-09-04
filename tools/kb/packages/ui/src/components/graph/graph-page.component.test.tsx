/**
 * GraphPage smoke: hydrated store renders header + canvas mount.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/fixtures/graph";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

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

import GraphPage from "./graph-page";

function seed() {
  useOutlineStore.setState({
    nodes: new Map(),
    wireNodes: [],
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    loadSource: null,
    loadError: null,
  });
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
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(container.textContent).toContain("graph");
    expect(container.textContent).toContain("All mentions");
    expect(container.textContent).toMatch(/\d+ nodes/);
    expect(container.querySelector('[data-renderer-switch="true"]')).not.toBeNull();
    const canvas = present(container.querySelector('[data-testid="sigma-graph"]'), "sigma graph");
    expect(Number(canvas.getAttribute("data-node-count"))).toBeGreaterThan(0);
  });
});
