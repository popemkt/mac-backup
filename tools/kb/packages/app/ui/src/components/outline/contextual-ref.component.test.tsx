/**
 * Contextual references — the render half.
 *
 * The reference row shows the target's content and edits it in place, its
 * children belong to the reference (not the target), and it is an ordinary
 * outline row everywhere else: same click, same bullet gestures, same
 * instance-key owner, same keyboard walk, same dashed ref bullet already used
 * for query-result rows.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { REF_SEED_WIRES, ctxRefWire } from "@/fixtures/contextual-ref";
import { fixtureGraph } from "@/api/fixture-graph";
import { childInstanceKey, outlineInstanceKey } from "@/lib/instance-key";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { rowTextOf } from "@/lib/contextual-ref";
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
  resetOutlineStore();
  useOutlineStore
    .getState()
    .hydrateFromWire([...fixtureGraph.nodes, ...extra], fixtureGraph.rev, "fixtures");
}

function click(el: Element, init: MouseEventInit = {}) {
  const Ctor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  el.dispatchEvent(new Ctor("click", { bubbles: true, cancelable: true, ...init }));
}

describe("contextual reference row", () => {
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
    const block = present(container.querySelector(`[data-instance-key="${key}"]`), "block");
    expect(block.textContent).toContain("Ship kb ui shell");
    expect(block.querySelector('[data-bullet-ref="true"]')).toBeTruthy();
    expect(block.querySelector("[data-bullet-ref-ring]")).toBeTruthy();
  });

  it("its children are its own and never appear under the target", async () => {
    useOutlineStore.getState().toggleCollapse("n.ctx");
    const refKey = await render("n.ctx");
    const childKey = childInstanceKey(refKey, "n.ctx-child");
    expect(container.querySelector(`[data-instance-key="${childKey}"]`)).toBeTruthy();

    // The original, rendered directly, knows nothing about the local child.
    const target = present(useOutlineStore.getState().nodes.get("n.root-a"), "n.root-a");
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

  function textOf(key: string): Element {
    return present(
      container.querySelector(
        `[data-instance-key="${key}"] .kb-md-view, [data-instance-key="${key}"] .kb-text-row`,
      ),
      "text",
    );
  }

  it("clicking the reference's text edits in place, like any row", async () => {
    const key = await render("n.ctx");
    await act(async () => click(textOf(key)));
    await render("n.ctx");
    const s = useOutlineStore.getState();
    // No navigation: the caret lands in this row, on this instance.
    expect(s.rootNodeId).not.toBe("n.root-a");
    expect(s.activeNodeId).toBe("n.ctx");
    expect(s.activeInstanceKey).toBe(key);
    const editor = present(
      container.querySelector(`[data-instance-key="${key}"] [contenteditable="true"]`),
      "editor",
    );
    expect(editor.textContent).toContain("Ship kb ui shell");
  });

  it("typing in the reference writes the original, never the reference", async () => {
    const key = await render("n.ctx");
    act(() => {
      useOutlineStore.getState().activateNode("n.ctx", 0, key);
    });
    await render("n.ctx");
    const editor = present(
      container.querySelector<HTMLElement>(`[data-instance-key="${key}"] [contenteditable="true"]`),
      "editor",
    );
    await act(async () => {
      editor.textContent = "Ship kb ui shell!";
      editor.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    });
    const s = useOutlineStore.getState();
    expect(s.nodes.get("n.root-a")?.text).toBe("Ship kb ui shell!");
    expect(s.nodes.get("n.ctx")?.text).toBe("");
    expect(rowTextOf(s, "n.ctx").text).toBe("Ship kb ui shell!");
  });

  it("the bullet: click toggles its own children, ⌘-click opens the original", async () => {
    const key = await render("n.ctx");
    const bullet = () =>
      present(
        container.querySelector(`[data-instance-key="${key}"] [data-bullet-ref="true"]`),
        "bullet",
      );
    const before = present(useOutlineStore.getState().nodes.get("n.ctx"), "n.ctx").collapsed;
    await act(async () => click(bullet()));
    expect(useOutlineStore.getState().nodes.get("n.ctx")?.collapsed).toBe(!before);
    expect(useOutlineStore.getState().rootNodeId).not.toBe("n.root-a");
    await act(async () => click(bullet(), { metaKey: true }));
    expect(useOutlineStore.getState().rootNodeId).toBe("n.root-a");
  });

  it("a dangling reference stays read-only: there is no text to write to", async () => {
    seed(ctxRefWires().concat(ctxRefWire("n.dangling", "n.gone")));
    const key = await render("n.dangling");
    act(() => {
      useOutlineStore.getState().activateNode("n.dangling", 0, key);
    });
    const s = useOutlineStore.getState();
    expect(s.activeNodeId).toBeNull();
    expect(s.selectedNodeId).toBe("n.dangling");
  });
});
