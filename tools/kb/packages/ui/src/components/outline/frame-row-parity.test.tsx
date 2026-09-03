/**
 * Parity between rendered frame rows and the visible-instance walk used for
 * keyboard navigation. These must agree: nav that targets an unrendered row
 * has nothing to focus or scroll to.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { NodeBlock } from "./node-block";

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
  useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

describe("frame row parity (render vs nav)", () => {
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
    g.MouseEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
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

  it("a paginated table frame navigates only to rows it renders", async () => {
    const { mutations } = await import("@/actions/mutations");
    useOutlineStore.getState().zoomTo("n.root-a");
    useOutlineStore.getState().toggleCollapse("n.root-a");

    await mutations.setViewMode("n.root-a", "table");
    await mutations.setViewPagesize("n.root-a", 1);

    await act(async () => {
      root.render(<NodeBlock nodeId="n.root-a" depth={0} />);
    });

    const renderedKeys = [
      ...container.querySelectorAll("[data-table-view] tr[data-instance-key]"),
    ].map((el) => el.getAttribute("data-instance-key"));

    const navKeys = useOutlineStore
      .getState()
      .getVisibleInstances()
      .map((i) => i.instanceKey);

    // pagesize=1 over a 2-child frame: exactly one row is rendered.
    expect(renderedKeys).toHaveLength(1);
    // Nav must not offer the row that pagination withheld.
    expect(navKeys).toEqual(renderedKeys);
  });
});
