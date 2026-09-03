/**
 * Contextual references — the render half.
 *
 * The reference row shows the target's content, its children belong to the
 * reference (not the target), and it is an ordinary outline row everywhere
 * else: same instance-key owner, same keyboard walk, same dashed ref bullet
 * already used for query-result rows.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { REF_SEED_WIRES, ctxRefWire } from "@/fixtures/contextual-ref";
import { fixtureGraph } from "@/fixtures/graph";
import { childInstanceKey, outlineInstanceKey } from "@/lib/instance-key";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { NodeBlock } from "./node-block";

const ISO = "2026-08-08T05:00:00.000Z";

/** A contextual reference at n.ctx → n.root-a, with one local child. */
function ctxRefWires(): WireNode[] {
  return [
    ...REF_SEED_WIRES,
    ctxRefWire("n.ctx", "n.root-a", { children: ["n.ctx-child"] }),
    {
      id: "n.ctx-child",
      text: "Only true in this context",
      props: {},
      children: [],
      createdAt: ISO,
      updatedAt: ISO,
    },
  ];
}

function seed(extra: WireNode[]) {
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
    .hydrateFromWire([...fixtureGraph.nodes, ...extra], fixtureGraph.rev, "fixtures");
}

describe("contextual reference row", () => {
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
    g.MouseEvent = dom.MouseEvent as unknown;
    g.Node = dom.Node as unknown;
    g.CSS = { escape: (s: string) => s };
  });

  beforeEach(() => {
    seed(ctxRefWires());
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(nodeId: string) {
    const key = outlineInstanceKey(nodeId, useOutlineStore.getState().nodes);
    await act(async () => {
      root.render(<NodeBlock nodeId={nodeId} instanceKey={key} depth={0} />);
    });
    return key;
  }

  it("renders the target's text and a dashed reference bullet", async () => {
    const key = await render("n.ctx");
    const block = container.querySelector(`[data-instance-key="${key}"]`);
    expect(block).toBeTruthy();
    expect(block!.textContent).toContain("Ship kb ui shell");
    expect(block!.querySelector('[data-bullet-ref="true"]')).toBeTruthy();
    expect(block!.querySelector("[data-bullet-ref-ring]")).toBeTruthy();
  });

  it("its children are its own and never appear under the target", async () => {
    useOutlineStore.getState().toggleCollapse("n.ctx");
    const refKey = await render("n.ctx");
    const childKey = childInstanceKey(refKey, "n.ctx-child");
    expect(container.querySelector(`[data-instance-key="${childKey}"]`)).toBeTruthy();

    // The original, rendered directly, knows nothing about the local child.
    const target = useOutlineStore.getState().nodes.get("n.root-a")!;
    expect(target.children).not.toContain("n.ctx-child");
    useOutlineStore.getState().toggleCollapse("n.root-a");
    await render("n.root-a");
    expect(container.querySelector('[data-node-id="n.ctx-child"]')).toBeNull();
  });

  it("is an ordinary row for instance keys and keyboard navigation", () => {
    useOutlineStore.getState().toggleCollapse("n.ctx");
    const refKey = outlineInstanceKey("n.ctx", useOutlineStore.getState().nodes);
    expect(refKey).toBe("tree/n.ctx");
    const instances = useOutlineStore.getState().getVisibleInstances();
    expect(instances.some((i) => i.instanceKey === refKey)).toBe(true);
    const next = useOutlineStore.getState().getNextVisibleInstance(refKey);
    expect(next?.instanceKey).toBe(childInstanceKey(refKey, "n.ctx-child"));
  });

  it("the target's text is not editable from the reference", async () => {
    const key = await render("n.ctx");
    act(() => {
      useOutlineStore.getState().activateNode("n.ctx", 0, key);
    });
    await render("n.ctx");
    const s = useOutlineStore.getState();
    expect(s.activeNodeId).toBeNull();
    expect(s.selectedNodeId).toBe("n.ctx");
    expect(
      container.querySelector(`[data-instance-key="${key}"] [contenteditable="true"]`),
    ).toBeNull();
  });

  it("clicking the reference's text opens the original instead of dying", async () => {
    const key = await render("n.ctx");
    const text = container.querySelector(
      `[data-instance-key="${key}"] .kb-md-view, [data-instance-key="${key}"] .kb-text-row`,
    );
    expect(text).toBeTruthy();
    await act(async () => {
      text!.dispatchEvent(
        new (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    expect(useOutlineStore.getState().rootNodeId).toBe("n.root-a");
  });
});
