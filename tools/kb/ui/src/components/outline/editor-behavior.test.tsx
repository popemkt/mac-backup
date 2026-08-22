/**
 * r1-editor §5.3 — end-to-end behavioral scenarios for the defect table.
 * D05 collapsed-indent · D08 first-child backspace · D10 wrapped-line
 * vertical nav · D14 autocomplete dismissal · §3.3 transient auto-prune.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outlineInstanceKey } from "@/lib/instance-key";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { mutations } from "@/actions/mutations";
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
    focusSeq: 0,
    focusX: null,
    transientIds: new Set<string>(),
    undoStack: [],
    redoStack: [],
  });
  useOutlineStore
    .getState()
    .hydrateFromWire(
      structuredClone(fixtureGraph.nodes),
      fixtureGraph.rev,
      "fixtures",
    );
}

describe("editor behavior scenarios (r1 §5.3)", () => {
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

  function fireKey(el: Element, key: string): boolean {
    const ev = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  function editorEl(instanceKey: string): HTMLElement | null {
    return container.querySelector(
      `[data-instance-key="${instanceKey}"] [contenteditable="true"]`,
    );
  }

  it("D05: Tab into a collapsed sibling expands it and keeps focus", async () => {
    const s0 = useOutlineStore.getState();
    // n.root-a starts collapsed (default) and precedes n.root-b.
    expect(s0.nodes.get("n.root-a")?.collapsed).toBe(true);

    const bKey = outlineInstanceKey("n.root-b", s0.nodes);
    act(() => {
      useOutlineStore.getState().activateNode("n.root-b", 4, bKey);
    });

    await act(async () => {
      await mutations.indentNode("n.root-b");
    });

    const s1 = useOutlineStore.getState();
    // Reparented under the previously collapsed sibling…
    expect(s1.nodes.get("n.root-b")?.parentId).toBe("n.root-a");
    // …which auto-expanded so the row stays visible…
    expect(s1.nodes.get("n.root-a")?.collapsed).toBe(false);
    expect(s1.getVisibleNodes()).toContain("n.root-b");
    // …and focus remains on the indented node.
    expect(s1.activeNodeId).toBe("n.root-b");
  });

  it("D08: Backspace at index 0 of a first child outdents instead of swallowing", async () => {
    act(() => {
      useOutlineStore.getState().toggleCollapse("n.root-a");
    });
    const nodes = useOutlineStore.getState().nodes;
    const childKey = outlineInstanceKey("n.child-a1", nodes);

    act(() => {
      useOutlineStore.getState().activateNode("n.child-a1", 0, childKey);
    });
    await act(async () => {
      root.render(
        <NodeBlock nodeId="n.child-a1" instanceKey={childKey} depth={0} />,
      );
    });

    const freshEditor = editorEl(childKey);
    expect(freshEditor).toBeTruthy();
    let prevented = false;
    await act(async () => {
      prevented = fireKey(freshEditor!, "Backspace");
    });

    const s = useOutlineStore.getState();
    // Key handled (not swallowed)…
    expect(prevented).toBe(true);
    // …node outdented to forest-root level (virtual workspace parent)…
    expect(s.nodes.get("n.child-a1")?.parentId).toBe(WORKSPACE_ROOT_ID);
    expect(s.nodes.get(WORKSPACE_ROOT_ID)!.children).toContain("n.child-a1");
    // …still present, still focused.
    expect(s.nodes.has("n.child-a1")).toBe(true);
    expect(s.activeNodeId).toBe("n.child-a1");
  });

  it("D10: ArrowUp crosses rows without requiring offset 0", async () => {
    const s0 = useOutlineStore.getState();
    const cKey = outlineInstanceKey("n.root-c", s0.nodes);
    // Caret parked mid-text (index 4 of "Read-only props panel…").
    act(() => {
      useOutlineStore.getState().activateNode("n.root-c", 4, cKey);
    });

    await act(async () => {
      root.render(
        <NodeBlock nodeId="n.root-c" instanceKey={cKey} depth={0} />,
      );
    });
    const el = editorEl(cKey);
    expect(el).toBeTruthy();

    let prevented = false;
    await act(async () => {
      prevented = fireKey(el!, "ArrowUp");
    });

    const s = useOutlineStore.getState();
    expect(prevented).toBe(true);
    // Previous visible row activated even though cursor ≠ 0.
    expect(s.activeNodeId).toBe("n.root-b");
  });

  it("D14: Escape dismisses autocomplete without leaving edit mode", async () => {
    act(() => {
      mutations.updateNodeContent("n.root-c", "[[");
    });
    const s0 = useOutlineStore.getState();
    const cKey = outlineInstanceKey("n.root-c", s0.nodes);
    act(() => {
      useOutlineStore.getState().activateNode("n.root-c", 2, cKey);
    });

    await act(async () => {
      root.render(
        <NodeBlock nodeId="n.root-c" instanceKey={cKey} depth={0} />,
      );
    });

    // Popup open with candidates.
    expect(
      container.querySelector('[role="listbox"]'),
    ).toBeTruthy();
    const el = editorEl(cKey);
    expect(el).toBeTruthy();

    await act(async () => {
      fireKey(el!, "Escape");
    });
    await act(async () => {
      root.render(
        <NodeBlock nodeId="n.root-c" instanceKey={cKey} depth={0} />,
      );
    });

    const s = useOutlineStore.getState();
    // Popup dismissed…
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    // …but the row never dropped to selection mode.
    expect(s.activeNodeId).toBe("n.root-c");
    expect(s.selectedNodeId).toBe("n.root-c");
  });

  it("§3.3: an empty transient node prunes when focus moves on", async () => {
    const before = useOutlineStore.getState().wireNodes.length;
    const newId = await mutations.createTransientNode("n.root-c", null);
    expect(newId).not.toBeNull();
    expect(useOutlineStore.getState().activeNodeId).toBe(newId);
    expect(useOutlineStore.getState().wireNodes.length).toBe(before + 1);

    // Focus elsewhere → silent prune.
    await act(async () => {
      useOutlineStore.getState().activateNode("n.root-b", 0);
    });

    const s = useOutlineStore.getState();
    expect(s.wireNodes.length).toBe(before);
    expect(s.nodes.has(newId!)).toBe(false);
    expect(s.activeNodeId).toBe("n.root-b");
  });
});
