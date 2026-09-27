/**
 * The date editor is keyboard-first: arrows move the date it is about to set
 * and the calendar follows, Enter sets it, Escape leaves it, and a day in the
 * calendar is one click. Typing phrases is `parseDateInput`'s (tested there):
 * React's `onChange` does not fire for an `<input>` under happy-dom.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { DateEditor } from "./date-editor";

describe("DateEditor", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let committed: string[];
  let cancelled: number;

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
    cancelled = 0;
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function open(initialText: string) {
    await act(async () => {
      root.render(
        createElement(DateEditor, {
          initialText,
          onCommit: (text: string) => committed.push(text),
          onCancel: () => (cancelled += 1),
        }),
      );
    });
    return present(container.querySelector<HTMLInputElement>('input[aria-label="Date"]'), "input");
  }

  async function press(input: HTMLInputElement, key: string, shiftKey = false) {
    await act(async () => {
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
  }

  const picked = () =>
    container.querySelector('[role="gridcell"][aria-selected="true"]')?.getAttribute("data-date");

  it("previews the typed date and marks it in the calendar", async () => {
    await open("2026-10-01");
    expect(picked()).toBe("2026-10-01");
    expect(container.querySelector('[data-date-preview="true"]')?.textContent).toContain("2026");
  });

  it("moves by a day, a week and a month, and the calendar follows", async () => {
    const input = await open("2026-10-01");
    await press(input, "ArrowDown");
    expect(input.value).toBe("2026-10-02");
    await press(input, "ArrowUp", true);
    expect(input.value).toBe("2026-09-25");
    expect(picked()).toBe("2026-09-25");
    await press(input, "PageDown");
    expect(input.value).toBe("2026-10-25");
    expect(picked()).toBe("2026-10-25");
  });

  it("Enter sets what is shown; Escape leaves without setting", async () => {
    const input = await open("2026-10-01");
    await press(input, "ArrowDown");
    await press(input, "Enter");
    expect(committed).toEqual(["2026-10-02"]);
    await press(input, "Escape");
    expect(cancelled).toBe(1);
  });

  it("a day in the calendar is one click", async () => {
    await open("2026-10-01");
    const day = present(
      container.querySelector<HTMLElement>('[role="gridcell"][data-date="2026-10-15"]'),
      "Oct 15",
    );
    await act(async () => {
      day.click();
    });
    expect(committed).toEqual(["2026-10-15"]);
  });

  it("keys never reach the outline behind the editor", async () => {
    let leaked = 0;
    await act(async () => {
      root.render(
        createElement(
          "div",
          { onKeyDown: () => (leaked += 1) },
          createElement(DateEditor, {
            initialText: "",
            onCommit: () => undefined,
            onCancel: () => undefined,
          }),
        ),
      );
    });
    const input = present(container.querySelector<HTMLInputElement>("input"), "input");
    await press(input, "ArrowDown");
    await press(input, "a");
    expect(leaked).toBe(0);
  });
});
