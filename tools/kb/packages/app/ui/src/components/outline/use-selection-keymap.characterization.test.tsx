/**
 * Characterization of the selection-mode dispatcher (GAP
 * [[01M1MGCDRS0K28YBF1Q86YY61S]]).
 *
 * `mapSelectionKey` is pinned as a pure table in `lib/selection-keymap.test.ts`;
 * this file pins the other half — what each action does to the store — by
 * driving the window keymap the way the app does. One case per
 * `SelectionKeyAction` variant, so the switch can become a record without the
 * store choreography inside a case going unwatched.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { outlineInstanceKey } from "@/lib/instance-key";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { installDomGlobals } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { useSelectionKeymap } from "./use-selection-keymap";

interface Mods {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

function Host() {
  useSelectionKeymap();
  return null;
}

function node(id: string) {
  return useOutlineStore.getState().nodes.get(id);
}

/**
 * Let React and the fire-and-forget mutation chains settle.
 *
 * Several rounds, not one: the outline's store writes go through
 * `void mutations.…().then(…)` chains, and under a loaded test run one tick
 * is not always enough for a chain to land before an assertion reads the
 * store — or, on the way out of a test, before the next one re-hydrates.
 */
async function settle(rounds = 4, delayMs = 0): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    });
  }
}

describe("selection-mode dispatcher (characterization)", () => {
  let dom: Window;
  const installed = { restore: () => {} };
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    const fresh = installDomGlobals();
    dom = fresh.window;
    installed.restore = fresh.restore;
  });

  afterAll(() => {
    installed.restore();
  });

  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore
      .getState()
      .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(async () => {
    // Generous on the way out: a delete whose promise is still in flight when
    // the next test re-hydrates would delete a row out of that test's graph.
    await settle(8, 1);
    act(() => root.unmount());
    container.remove();
  });

  /** Select `nodeId` at its outline instance and mount the window keymap. */
  function selectAndMount(nodeId: string): void {
    const instanceKey = outlineInstanceKey(nodeId, useOutlineStore.getState().nodes);
    act(() => {
      useOutlineStore.getState().selectNode(nodeId, instanceKey);
    });
    act(() => {
      root.render(<Host />);
    });
  }

  async function press(key: string, mods: Mods = {}): Promise<void> {
    const ev = new dom.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...mods,
    });
    await act(async () => {
      dom.document.body.dispatchEvent(ev);
    });
    await settle();
  }

  it("select: an arrow moves the selection to the neighbouring instance", async () => {
    selectAndMount("n.root-b");
    await press("ArrowDown");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-c");
    expect(useOutlineStore.getState().selectedInstanceKey).toBe(
      outlineInstanceKey("n.root-c", useOutlineStore.getState().nodes),
    );
  });

  it("clear: Escape drops the selection", async () => {
    selectAndMount("n.root-b");
    await press("Escape");
    expect(useOutlineStore.getState().selectedNodeId).toBeNull();
  });

  it("edit: Enter activates the row", async () => {
    selectAndMount("n.root-b");
    await press("Enter");
    expect(useOutlineStore.getState().activeNodeId).toBe("n.root-b");
  });

  it("toggleCollapse: Space flips the row open", async () => {
    selectAndMount("n.root-a");
    expect(node("n.root-a")?.collapsed).toBe(true);
    await press(" ");
    expect(node("n.root-a")?.collapsed).toBe(false);
  });

  it("collapse: ArrowLeft on an expanded parent closes it", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.root-a");
    await press("ArrowLeft");
    expect(node("n.root-a")?.collapsed).toBe(true);
  });

  it("expand: ArrowRight on a collapsed parent opens it", async () => {
    selectAndMount("n.root-a");
    await press("ArrowRight");
    expect(node("n.root-a")?.collapsed).toBe(false);
  });

  it("selectParent: ArrowLeft on a leaf climbs", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.child-a1");
    await press("ArrowLeft");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-a");
  });

  it("selectFirstChild: ArrowRight on an expanded parent descends", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.root-a");
    await press("ArrowRight");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.child-a1");
  });

  it("indent: Tab reparents into the previous sibling", async () => {
    selectAndMount("n.root-b");
    await press("Tab");
    expect(node("n.root-b")?.parentId).toBe("n.root-a");
  });

  it("outdent: Shift+Tab lifts a child to the forest", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.child-a1");
    await press("Tab", { shiftKey: true });
    expect(node("n.child-a1")?.parentId).toBe(WORKSPACE_ROOT_ID);
  });

  it("moveUp: Meta+Shift+ArrowUp swaps with the previous sibling", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.child-a2");
    await press("ArrowUp", { metaKey: true, shiftKey: true });
    expect(node("n.root-a")?.children).toEqual(["n.child-a2", "n.child-a1"]);
  });

  it("moveDown: Meta+Shift+ArrowDown swaps with the next sibling", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.child-a1");
    await press("ArrowDown", { metaKey: true, shiftKey: true });
    expect(node("n.root-a")?.children).toEqual(["n.child-a2", "n.child-a1"]);
  });

  it("zoom: Meta+. enters the row", async () => {
    selectAndMount("n.root-b");
    await press(".", { metaKey: true });
    expect(useOutlineStore.getState().rootNodeId).toBe("n.root-b");
  });

  it("createAfter: o on an expanded parent mints a child of it", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.root-a");
    await press("o");
    const minted = useOutlineStore.getState().activeNodeId;
    expect(minted).not.toBeNull();
    expect(node(String(minted))?.parentId).toBe("n.root-a");
  });

  it("createAfter: o on a leaf mints the next sibling", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.child-a1");
    await press("o");
    const minted = useOutlineStore.getState().activeNodeId;
    expect(minted).not.toBeNull();
    expect(node("n.root-a")?.children).toEqual(["n.child-a1", minted, "n.child-a2"]);
  });

  it("createBefore: O mints the row directly above", async () => {
    act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
    selectAndMount("n.child-a2");
    await press("O");
    const minted = useOutlineStore.getState().activeNodeId;
    expect(minted).not.toBeNull();
    expect(node("n.root-a")?.children).toEqual(["n.child-a1", minted, "n.child-a2"]);
  });

  it("append: a printable key edits at the end with the character added", async () => {
    const before = node("n.root-b")?.text ?? "";
    selectAndMount("n.root-b");
    await press("x");
    expect(node("n.root-b")?.text).toBe(`${before}x`);
    expect(useOutlineStore.getState().activeNodeId).toBe("n.root-b");
  });

  it("delete: Backspace removes the row and selects its predecessor", async () => {
    selectAndMount("n.root-c");
    await press("Backspace");
    expect(node("n.root-c")).toBeUndefined();
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
  });

  it("an unmapped chord leaves the store alone", async () => {
    selectAndMount("n.root-b");
    const before = useOutlineStore.getState().wireNodes.length;
    await press("F5");
    await press("k", { metaKey: true });
    expect(useOutlineStore.getState().wireNodes.length).toBe(before);
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
  });
});
