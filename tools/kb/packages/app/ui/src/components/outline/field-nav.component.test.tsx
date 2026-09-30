/**
 * Field values are in the outline's keyboard path: a row's values sit
 * between its text and the next row, and the arrows pass through them in the
 * order they are drawn. Driven through a real `NodeBlock` and the store.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { outlineInstanceKey } from "@/lib/instance-key";
import { setCaretSerializedOffset } from "@/lib/md-edit";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { NodeBlock } from "./node-block";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { syncUiPlugins } from "@/lib/plugins";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncUiPlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const ISO = "2026-09-28T00:00:00.000Z";
const wire = (partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode => ({
  props: {},
  children: [],
  createdAt: ISO,
  updatedAt: ISO,
  ...partial,
});

const GRAPH: WireNode[] = [
  wire({ id: "n.p", text: "Parent", children: ["n.a", "n.b"] }),
  wire({
    id: "n.a",
    text: "Alpha",
    props: {
      "f.note": [
        { t: "str", v: "one" },
        { t: "str", v: "two" },
      ],
    },
  }),
  wire({ id: "n.b", text: "Beta" }),
  wire({
    id: "f.note",
    text: "note",
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
  }),
];

const keyOf = (id: string) => outlineInstanceKey(id, useOutlineStore.getState().nodes);

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("field values in the outline's keyboard path", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(async () => {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(GRAPH, 1, "fixtures");
    useOutlineStore.getState().toggleCollapse("n.a");
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<NodeBlock nodeId="n.p" depth={0} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const focused = () => dom.window.document.activeElement as unknown as HTMLElement | null;
  const slots = () => [...container.querySelectorAll<HTMLElement>('[data-value-slot="text"]')];

  async function press(target: Element, key: string, init: { shiftKey?: boolean } = {}) {
    await act(async () => {
      target.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        }) as unknown as Event,
      );
    });
    await settle();
  }

  async function editRow(id: string, at: number) {
    await act(async () => {
      useOutlineStore.getState().activateNode(id, at, keyOf(id));
    });
    await settle();
    const editor = present(
      container.querySelector<HTMLElement>(
        `[data-instance-key="${keyOf(id)}"] .node-row [contenteditable="true"]`,
      ),
      `${id}'s editor`,
    );
    setCaretSerializedOffset(editor, at);
    return editor;
  }

  it("↓ from a row's last line lands on its first value; on through the values; out to the next row", async () => {
    const alpha = await editRow("n.a", 5);
    await press(alpha, "ArrowDown");
    expect(focused()).toBe(slots()[0]);
    await press(present(focused(), "first value"), "ArrowDown");
    expect(focused()).toBe(slots()[1]);
    await press(present(focused(), "second value"), "ArrowDown");
    const s = useOutlineStore.getState();
    expect(s.activeNodeId).toBe("n.b");
  });

  it("↑ from the next row comes back through the row above's values, to its text", async () => {
    const beta = await editRow("n.b", 0);
    await press(beta, "ArrowUp");
    expect(focused()).toBe(slots()[1]);
    await press(present(focused(), "last value"), "Tab", { shiftKey: true });
    expect(focused()).toBe(slots()[0]);
    await press(present(focused(), "first value"), "ArrowUp");
    expect(useOutlineStore.getState().activeNodeId).toBe("n.a");
  });

  it("Escape on a value hands the keyboard back to its row, selected", async () => {
    const alpha = await editRow("n.a", 5);
    await press(alpha, "ArrowDown");
    await press(present(focused(), "value"), "Escape");
    const s = useOutlineStore.getState();
    expect(s.selectedNodeId).toBe("n.a");
    expect(s.activeNodeId).toBeNull();
  });

  it("Backspace on a value at rest takes it out and lands on its neighbour", async () => {
    const alpha = await editRow("n.a", 5);
    await press(alpha, "ArrowDown");
    await press(present(focused(), "first value"), "Backspace");
    expect(useOutlineStore.getState().nodes.get("n.a")?.props["f.note"]).toEqual([
      { t: "str", v: "two" },
    ]);
    expect(focused()?.textContent).toBe("two");
  });

  it("a key typed on a value at rest opens it, replacing the value", async () => {
    const alpha = await editRow("n.a", 5);
    await press(alpha, "ArrowDown");
    await press(present(focused(), "first value"), "z");
    const editor = present(
      container.querySelector<HTMLElement>('[data-value-slot="text"] [contenteditable="true"]'),
      "open editor",
    );
    expect(editor.textContent).toBe("z");
  });
});
