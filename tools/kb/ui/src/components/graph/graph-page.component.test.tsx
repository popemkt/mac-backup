/**
 * GraphPage smoke: hydrated store renders header + sigma canvas mount.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import GraphPage from "./graph-page";

vi.mock("@/components/graph/sigma-graph", () => ({
  SigmaGraph: (props: { nodes: unknown[]; edges: unknown[] }) =>
    createElement("div", {
      "data-testid": "sigma-graph",
      "data-node-count": props.nodes.length,
      "data-edge-count": props.edges.length,
    }),
}));

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
    cursorPosition: 0,
    loadSource: null,
    loadError: null,
  });
  useOutlineStore
    .getState()
    .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

describe("GraphPage (smoke)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom as unknown;
    g.document = dom.document as unknown;
    g.HTMLElement = dom.HTMLElement as unknown;
    g.KeyboardEvent = dom.KeyboardEvent as unknown;
    g.Node = dom.Node as unknown;
    g.PointerEvent = (dom.PointerEvent ?? dom.MouseEvent) as unknown;
    g.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      Number(dom.setTimeout(() => cb(0), 0))) as unknown;
    g.cancelAnimationFrame = ((id: number) => {
      dom.clearTimeout(id as unknown as ReturnType<typeof dom.setTimeout>);
    }) as unknown;
  });

  beforeEach(() => {
    seed();
    container = dom.document.createElement(
      "div",
    ) as unknown as HTMLDivElement;
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
    const canvas = container.querySelector('[data-testid="sigma-graph"]');
    expect(canvas).not.toBeNull();
    expect(Number(canvas!.getAttribute("data-node-count"))).toBeGreaterThan(0);
  });
});
