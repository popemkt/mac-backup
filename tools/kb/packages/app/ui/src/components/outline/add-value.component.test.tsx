/**
 * Adding a value is the gesture in hand, not a line of its own: Enter at the
 * end of a typed value of a many-valued field opens the next, Enter on that
 * empty one closes it, and a typed value emptied is taken out. Driven through
 * the real stack and store, so what is asserted is what the field holds.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { setCaretSerializedOffset } from "@/lib/md-edit";
import { fieldContextOf } from "@/lib/schema";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldValueStack } from "./fields-section";

const ISO = "2026-09-28T00:00:00.000Z";
const wire = (partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode => ({
  props: {},
  children: [],
  createdAt: ISO,
  updatedAt: ISO,
  ...partial,
});

const held = () => useOutlineStore.getState().nodes.get("n.host")?.props["f.note"] ?? [];

describe("adding a value", () => {
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

  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(
      [
        wire({ id: "n.host", text: "Host", props: { "f.note": [{ t: "str", v: "one" }] } }),
        wire({
          id: "f.note",
          text: "note",
          props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
        }),
      ],
      1,
      "fixtures",
    );
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(
        <FieldValueStack
          nodeId="n.host"
          fieldId="f.note"
          fieldType="text"
          values={held()}
          context={fieldContextOf(useOutlineStore.getState())}
          readOnly={false}
          onFollow={() => undefined}
        />,
      );
    });
  }

  const editor = () =>
    present(container.querySelector<HTMLElement>('[contenteditable="true"]'), "open editor");

  async function key(k: string) {
    await act(async () => {
      editor().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
  }

  /** The slot asked its editor to leave; happy-dom's blur does not say so. */
  async function leave(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
  }

  it("has no line of its own: the add is inline on the last value", async () => {
    await render();
    expect(container.querySelectorAll('[data-add-value="true"]').length).toBe(1);
    expect(container.textContent).not.toContain("value");
  });

  it("Enter at the end of a value opens the next; Enter on that empty one closes it", async () => {
    await render();
    await act(async () => {
      present(container.querySelector<HTMLElement>('[data-value-slot="text"]'), "slot").click();
    });
    const first = editor();
    setCaretSerializedOffset(first, 3);
    await key("Enter");
    await leave(first);
    await render();
    // The next value's slot is open, focused, and says what it is for.
    const next = editor();
    expect(next.getAttribute("data-placeholder")).toBe("Enter to add another · Esc to finish");
    expect(held()).toEqual([{ t: "str", v: "one" }]);

    await key("Enter");
    await leave(next);
    await render();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(held()).toEqual([{ t: "str", v: "one" }]);
  });

  it("what is typed into the next slot is the next value", async () => {
    await render();
    await act(async () => {
      present(container.querySelector<HTMLElement>('[data-add-value="true"]'), "+").click();
    });
    const next = editor();
    next.textContent = "two";
    await leave(next);
    await render();
    expect(held()).toEqual([
      { t: "str", v: "one" },
      { t: "str", v: "two" },
    ]);
  });

  it("a typed value emptied is taken out, not kept blank", async () => {
    await render();
    await act(async () => {
      present(container.querySelector<HTMLElement>('[data-value-slot="text"]'), "slot").click();
    });
    const el = editor();
    el.textContent = "";
    await leave(el);
    await render();
    expect(held()).toEqual([]);
  });
});
