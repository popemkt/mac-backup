/**
 * The slot owns the gestures, for every kind: a surface draws, the slot
 * decides what a click and a key do. These pin the keyboard half of that —
 * Enter keeps an edit, Escape puts the value back — and that a key an editing
 * slot receives never reaches the outline behind it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { fieldContextOf } from "@/lib/schema";
import type { NodeMap, PropValue } from "@/lib/types";
import { ValueSlot } from "./value-slot";

const context = fieldContextOf({
  ontologyId: null,
  nodes: new Map() as NodeMap,
  wireNodes: [],
  index: null,
});

describe("ValueSlot gestures", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let committed: PropValue[];
  let leaked: number;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    committed = [];
    leaked = 0;
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount(value: PropValue) {
    await act(async () => {
      root.render(
        createElement(
          "div",
          { onKeyDown: () => (leaked += 1) },
          createElement(ValueSlot, {
            value,
            fieldType: "text",
            fieldId: "f.value",
            context,
            onCommit: (next: PropValue) => committed.push(next),
            onFollow: () => undefined,
          }),
        ),
      );
    });
    return present(container.querySelector<HTMLElement>('[data-value-slot="text"]'), "slot");
  }

  const editable = () =>
    present(container.querySelector<HTMLElement>('[data-editable-text="true"]'), "editable");

  async function press(key: string) {
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
  }

  it("a click on the slot opens its editor in place", async () => {
    const slot = await mount({ t: "str", v: "before" });
    expect(slot.getAttribute("data-editing")).toBeNull();
    await act(async () => {
      slot.click();
    });
    expect(slot.getAttribute("data-editing")).toBe("true");
    expect(editable().getAttribute("contenteditable")).toBe("true");
  });

  it("Enter keeps what was typed and leaves the editor", async () => {
    const slot = await mount({ t: "str", v: "before" });
    await act(async () => {
      slot.click();
    });
    editable().textContent = "after";
    await press("Enter");
    // happy-dom's blur() does not dispatch focusout on a contenteditable div;
    // the slot asked the editor to leave, which is what blur models here.
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
    expect(committed).toEqual([{ t: "str", v: "after" }]);
    expect(leaked).toBe(0);
  });

  it("Escape puts the value back", async () => {
    const slot = await mount({ t: "str", v: "before" });
    await act(async () => {
      slot.click();
    });
    editable().textContent = "typed";
    await press("Escape");
    expect(editable().textContent).toBe("before");
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
    expect(committed).toEqual([]);
    expect(leaked).toBe(0);
  });

  it("a key at rest is not the slot's to take", async () => {
    await mount({ t: "str", v: "before" });
    await press("ArrowDown");
    expect(leaked).toBe(1);
  });
});
