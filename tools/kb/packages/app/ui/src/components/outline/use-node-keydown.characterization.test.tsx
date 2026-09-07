/**
 * Characterization of the outline editing keymap (GAP [[01M1MGCQKVQCG3H9YYCWQX0A0Y]]).
 *
 * Every chord the handler routes, pinned before the chain becomes a table:
 * whether the key is claimed (`preventDefault`) and the one store fact that
 * proves which branch ran. It is the gate for the refactor, so it must pass
 * unchanged on both sides of it.
 *
 * The host is a bare contenteditable rather than `NodeBlock`: `isRef` and the
 * caret are inputs to the keymap, and driving them directly is what makes the
 * ref-instance rows reachable at all.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { outlineInstanceKey } from "@/lib/instance-key";
import { renderEditableContent, setCaretSerializedOffset } from "@/lib/md-edit";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { installDomGlobals } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { useNodeKeyDown } from "./use-node-keydown";

interface Mods {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

function Host({
  nodeId,
  instanceKey,
  isRef,
}: {
  nodeId: string;
  instanceKey: string;
  isRef: boolean;
}) {
  // Subscribed so the host re-renders as the store changes, the way a row does.
  useOutlineStore((s) => s.nodes.get(nodeId));
  const onKeyDown = useNodeKeyDown({ nodeId, instanceKey, isRef });
  return <div data-editor="true" contentEditable onKeyDown={onKeyDown} />;
}

function keyOf(nodeId: string): string {
  return outlineInstanceKey(nodeId, useOutlineStore.getState().nodes);
}

function node(id: string) {
  return useOutlineStore.getState().nodes.get(id);
}

describe("outline editing keymap (characterization)", () => {
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => root.unmount());
    container.remove();
  });

  /**
   * Mount the host on `nodeId`, activate the row and park the caret at
   * `cursor`. The row is activated because that is the only state this handler
   * runs in: an outline row that is being edited.
   */
  function mount(nodeId: string, cursor: number, isRef = false): HTMLElement {
    const instanceKey = keyOf(nodeId);
    act(() => {
      useOutlineStore.getState().activateNode(nodeId, cursor, instanceKey);
    });
    act(() => {
      root.render(<Host nodeId={nodeId} instanceKey={instanceKey} isRef={isRef} />);
    });
    const el = present(
      container.querySelector<HTMLElement>('[data-editor="true"]'),
      "characterization editor",
    );
    const text = useOutlineStore.getState().nodes.get(nodeId)?.text ?? "";
    renderEditableContent(el, text);
    setCaretSerializedOffset(el, cursor);
    return el;
  }

  /** Fire one chord; returns whether the handler claimed it. */
  async function press(el: HTMLElement, key: string, mods: Mods = {}): Promise<boolean> {
    const ev = new dom.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...mods,
    });
    await act(async () => {
      el.dispatchEvent(ev as unknown as Event);
      // A macrotask, not a microtask: the handler's store writes go through
      // fire-and-forget `void mutations.…().then(…)` chains, and a chain that
      // lands after the test would land in the next test's store.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return ev.defaultPrevented;
  }

  function siblingOrder(parentId: string): string[] {
    return node(parentId)?.children ?? [];
  }

  function endOf(id: string): number {
    return node(id)?.text.length ?? 0;
  }

  describe("ref instances: structural chords are swallowed, the rest fall through", () => {
    it("Tab is claimed and does nothing", async () => {
      const before = node("n.root-b")?.parentId;
      expect(await press(mount("n.root-b", 3, true), "Tab")).toBe(true);
      expect(node("n.root-b")?.parentId).toBe(before);
    });

    it("Enter is claimed and does not split", async () => {
      const before = useOutlineStore.getState().wireNodes.length;
      expect(await press(mount("n.root-b", 3, true), "Enter")).toBe(true);
      expect(useOutlineStore.getState().wireNodes.length).toBe(before);
    });

    it("Backspace at offset 0 is claimed and does not outdent", async () => {
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      const before = node("n.child-a1")?.parentId;
      expect(await press(mount("n.child-a1", 0, true), "Backspace")).toBe(true);
      expect(node("n.child-a1")?.parentId).toBe(before);
    });

    it("Meta+Shift+ArrowUp is claimed and does not reorder", async () => {
      const before = node(WORKSPACE_ROOT_ID)?.children.join(",");
      expect(
        await press(mount("n.root-b", 3, true), "ArrowUp", { metaKey: true, shiftKey: true }),
      ).toBe(true);
      expect(node(WORKSPACE_ROOT_ID)?.children.join(",")).toBe(before);
    });

    it("Ctrl+Shift+ArrowUp is NOT structural: it reaches the collapse branch", async () => {
      // The ref guard names metaKey only, so the ctrl spelling falls through to
      // the `metaKey || ctrlKey` arm below — collapse, not reorder.
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      expect(node("n.root-a")?.collapsed).toBe(false);
      expect(
        await press(mount("n.root-a", 0, true), "ArrowUp", { ctrlKey: true, shiftKey: true }),
      ).toBe(true);
      expect(node("n.root-a")?.collapsed).toBe(true);
    });

    it("Backspace mid-text is left to the browser", async () => {
      expect(await press(mount("n.root-b", 3, true), "Backspace")).toBe(false);
    });

    it("Meta+Backspace mid-text IS structural here, unlike a plain row", async () => {
      expect(await press(mount("n.root-b", 3, true), "Backspace", { metaKey: true })).toBe(true);
      expect(node("n.root-b")).toBeDefined();
    });

    it("a printable key is left to the browser", async () => {
      expect(await press(mount("n.root-b", 3, true), "x")).toBe(false);
    });
  });

  describe("Enter", () => {
    it("Shift+Enter inserts a soft break at the caret", async () => {
      expect(await press(mount("n.root-c", 4, false), "Enter", { shiftKey: true })).toBe(true);
      expect(node("n.root-c")?.text.startsWith("Read\n")).toBe(true);
      expect(useOutlineStore.getState().activeNodeId).toBe("n.root-c");
    });

    it("Enter splits the row", async () => {
      const before = useOutlineStore.getState().wireNodes.length;
      expect(await press(mount("n.root-c", 4, false), "Enter")).toBe(true);
      expect(node("n.root-c")?.text).toBe("Read");
      expect(useOutlineStore.getState().wireNodes.length).toBe(before + 1);
    });
  });

  describe("Tab", () => {
    it("Tab indents into the previous sibling", async () => {
      expect(await press(mount("n.root-b", 3, false), "Tab")).toBe(true);
      expect(node("n.root-b")?.parentId).toBe("n.root-a");
    });

    it("Shift+Tab outdents", async () => {
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      expect(await press(mount("n.child-a1", 3, false), "Tab", { shiftKey: true })).toBe(true);
      expect(node("n.child-a1")?.parentId).toBe(WORKSPACE_ROOT_ID);
    });
  });

  describe("Backspace", () => {
    it("mid-text is left to the browser", async () => {
      expect(await press(mount("n.root-b", 3, false), "Backspace")).toBe(false);
    });

    it("mid-text wins over the modifier: Meta+Backspace there is still native", async () => {
      // `cursor !== 0` returns before the modifier is read, so the subtree
      // delete is an offset-0 gesture even with Meta held.
      expect(await press(mount("n.root-b", 3, false), "Backspace", { metaKey: true })).toBe(false);
      expect(node("n.root-b")).toBeDefined();
    });

    it("Meta+Backspace at offset 0 deletes the subtree", async () => {
      expect(await press(mount("n.root-b", 0, false), "Backspace", { metaKey: true })).toBe(true);
      expect(node("n.root-b")).toBeUndefined();
    });

    it("Ctrl+Backspace at offset 0 deletes the subtree too", async () => {
      expect(await press(mount("n.root-b", 0, false), "Backspace", { ctrlKey: true })).toBe(true);
      expect(node("n.root-b")).toBeUndefined();
    });

    it("an empty leaf deletes itself", async () => {
      await act(async () => {
        await mutations.updateNodeContent("n.root-c", "");
      });
      expect(await press(mount("n.root-c", 0, false), "Backspace")).toBe(true);
      expect(node("n.root-c")).toBeUndefined();
    });

    it("a first child at offset 0 outdents (D08)", async () => {
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      expect(await press(mount("n.child-a1", 0, false), "Backspace")).toBe(true);
      expect(node("n.child-a1")?.parentId).toBe(WORKSPACE_ROOT_ID);
    });

    it("a later sibling at offset 0 merges into its visible predecessor (D09)", async () => {
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      const merged =
        present(node("n.child-a1"), "predecessor").text + present(node("n.child-a2"), "row").text;
      expect(await press(mount("n.child-a2", 0, false), "Backspace")).toBe(true);
      expect(node("n.child-a2")).toBeUndefined();
      expect(node("n.child-a1")?.text).toBe(merged);
    });
  });

  describe("Delete", () => {
    it("mid-text is left to the browser", async () => {
      expect(await press(mount("n.root-b", 3, false), "Delete")).toBe(false);
    });

    it("Meta+Delete deletes the subtree", async () => {
      expect(await press(mount("n.root-b", 3, false), "Delete", { metaKey: true })).toBe(true);
      expect(node("n.root-b")).toBeUndefined();
    });

    it("at end of text merges the next visible row in (F13)", async () => {
      const merged = present(node("n.root-b"), "row").text + present(node("n.root-c"), "next").text;
      expect(await press(mount("n.root-b", endOf("n.root-b"), false), "Delete")).toBe(true);
      expect(node("n.root-b")?.text).toBe(merged);
      expect(node("n.root-c")).toBeUndefined();
    });

    it("at end of the last visible row is left to the browser", async () => {
      expect(await press(mount("n.root-c", endOf("n.root-c"), false), "Delete")).toBe(false);
    });
  });

  describe("vertical arrows", () => {
    it("Meta+Shift+ArrowUp reorders the row above its previous sibling", async () => {
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      expect(siblingOrder("n.root-a")).toEqual(["n.child-a1", "n.child-a2"]);
      expect(
        await press(mount("n.child-a2", 3, false), "ArrowUp", { metaKey: true, shiftKey: true }),
      ).toBe(true);
      expect(siblingOrder("n.root-a")).toEqual(["n.child-a2", "n.child-a1"]);
    });

    it("Meta+Shift+ArrowDown reorders the row below its next sibling", async () => {
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      expect(
        await press(mount("n.child-a1", 3, false), "ArrowDown", { metaKey: true, shiftKey: true }),
      ).toBe(true);
      expect(siblingOrder("n.root-a")).toEqual(["n.child-a2", "n.child-a1"]);
    });

    it("Meta+ArrowUp collapses an expanded parent", async () => {
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      expect(await press(mount("n.root-a", 0, false), "ArrowUp", { metaKey: true })).toBe(true);
      expect(node("n.root-a")?.collapsed).toBe(true);
    });

    it("Meta+ArrowUp on a leaf zooms to the enclosing page", async () => {
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      expect(await press(mount("n.child-a1", 0, false), "ArrowUp", { metaKey: true })).toBe(true);
      expect(useOutlineStore.getState().rootNodeId).toBe("n.root-a");
    });

    it("Meta+ArrowDown expands a collapsed parent", async () => {
      expect(node("n.root-a")?.collapsed).toBe(true);
      expect(await press(mount("n.root-a", 0, false), "ArrowDown", { metaKey: true })).toBe(true);
      expect(node("n.root-a")?.collapsed).toBe(false);
    });

    it("Meta+ArrowDown on a row with nothing to reveal is claimed and inert", async () => {
      // No children and no tags: tags alone make a childless row expandable,
      // which is why this case cannot use one of the tagged fixture rows.
      act(() => useOutlineStore.getState().toggleCollapse("n.root-a"));
      const el = mount("n.child-a1", 3, false);
      const before = {
        collapsed: node("n.child-a1")?.collapsed,
        active: useOutlineStore.getState().activeNodeId,
      };
      expect(await press(el, "ArrowDown", { metaKey: true })).toBe(true);
      const after = useOutlineStore.getState();
      expect(after.activeNodeId).toBe(before.active);
      expect(node("n.child-a1")?.collapsed).toBe(before.collapsed);
      expect(after.rootNodeId).toBe(WORKSPACE_ROOT_ID);
    });

    it("Meta+ArrowDown on a childless but tagged row still reveals its fields", async () => {
      // `tags.length > 0` is part of the expandable test, so the chord is not a
      // children-only gesture.
      const el = mount("n.root-b", 3, false);
      expect(node("n.root-b")?.collapsed).toBe(true);
      expect(await press(el, "ArrowDown", { metaKey: true })).toBe(true);
      expect(node("n.root-b")?.collapsed).toBe(false);
    });

    it("bare ArrowUp crosses to the previous visible row", async () => {
      expect(await press(mount("n.root-c", 4, false), "ArrowUp")).toBe(true);
      expect(useOutlineStore.getState().activeNodeId).toBe("n.root-b");
    });

    it("bare ArrowDown crosses to the next visible row", async () => {
      expect(await press(mount("n.root-b", 4, false), "ArrowDown")).toBe(true);
      expect(useOutlineStore.getState().activeNodeId).toBe("n.root-c");
    });

    it("bare ArrowDown at the document edge is left to the browser", async () => {
      expect(await press(mount("n.root-c", 4, false), "ArrowDown")).toBe(false);
    });
  });

  describe("the rest", () => {
    it("Escape drops to selection mode", async () => {
      expect(await press(mount("n.root-b", 3, false), "Escape")).toBe(true);
      expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
    });

    it("an unmapped key is left to the browser", async () => {
      expect(await press(mount("n.root-b", 3, false), "x")).toBe(false);
      expect(await press(mount("n.root-b", 3, false), "F5")).toBe(false);
      expect(await press(mount("n.root-b", 3, false), "ArrowLeft")).toBe(false);
    });
  });
});
