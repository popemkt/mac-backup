/**
 * What every declared field type renders, and what a commit writes.
 *
 * `PropValueEditor` picked its editor with a `switch` over `FieldType` and a
 * leading `if` on `fieldId`; `EmptyTypedEditor` repeated the `fieldId` half and
 * `FieldRow` repeated it a third time for the icon. This file is the matrix
 * those three shapes have to keep answering the same way once one registry
 * answers it: for each of the six `sys.ft.*` types, in each of {display,
 * editing, empty}, which editor mounts and what `onCommit` receives.
 *
 * Written before the registry, unchanged through it.
 *
 * One blind spot, stated rather than hidden: React's `onChange` does not fire
 * for an `<input>` under happy-dom (its `onInput` does), so the two writes that
 * can only come from typing into a real input — the native date picker's pick,
 * and the ref picker's "commit the raw text nothing matched" fallback — are
 * pinned by what the editor *offers* rather than by the value it writes.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { stubOutlineNode } from "@/catalog/fixtures";
import { emptyValueForType, FIELD_TYPES, type FieldType } from "@/lib/field-type";
import { SYSTEM_IDS, type NodeMap, type PropValue } from "@/lib/types";
import { FieldRow } from "./field-row";
import { EmptyTypedEditor, PropValueEditor } from "./field-value";

const nodes: NodeMap = new Map([
  ["n.target", stubOutlineNode({ id: "n.target", text: "Target one" })],
  ["n.other", stubOutlineNode({ id: "n.other", text: "Target two" })],
]);

/** A filled value of the shape each type's editor expects to see. */
const FILLED: Record<FieldType, PropValue> = {
  text: { t: "str", v: "hello" },
  number: { t: "num", v: 42 },
  date: { t: "str", v: "2026-03-04" },
  url: { t: "str", v: "https://example.com" },
  checkbox: { t: "bool", v: true },
  ref: { t: "ref", v: "n.target" },
};

function editorHtml(
  fieldType: FieldType,
  value: PropValue,
  extra: { fieldId?: string; autoOpen?: boolean; display?: string } = {},
): string {
  return renderToStaticMarkup(
    createElement(PropValueEditor, {
      value,
      display: extra.display ?? "",
      fieldType,
      fieldId: extra.fieldId,
      allowedRefIds: null,
      autoOpen: extra.autoOpen ?? false,
      onCommit: () => undefined,
      nodes,
    }),
  );
}

function emptyHtml(fieldType: FieldType, fieldId?: string, autoOpen = false): string {
  return renderToStaticMarkup(
    createElement(EmptyTypedEditor, {
      fieldType,
      fieldId,
      allowedRefIds: null,
      autoOpen,
      onCommit: () => undefined,
      nodes,
    }),
  );
}

/**
 * The marker each type's editor puts in the DOM. One row per type, so a type
 * routed to the wrong editor is a failing row rather than a subtle diff.
 */
const EDITOR_MARKER: Record<FieldType, string> = {
  text: 'data-editable-text="true"',
  number: 'data-editable-text="true"',
  url: 'data-editable-text="true"',
  date: ">Mar 4, 2026<",
  checkbox: 'aria-pressed="true"',
  ref: 'data-node-row="true"',
};

describe("every declared type routes to one editor (display)", () => {
  it("covers all six declared types", () => {
    expect([...FIELD_TYPES].toSorted()).toEqual(
      ["checkbox", "date", "number", "ref", "text", "url"].toSorted(),
    );
  });

  for (const fieldType of FIELD_TYPES) {
    it(`${fieldType} renders its own editor`, () => {
      expect(editorHtml(fieldType, FILLED[fieldType])).toContain(EDITOR_MARKER[fieldType]);
    });
  }

  it("text shows the string plainly, url underlines it", () => {
    const text = editorHtml("text", { t: "str", v: "hello" });
    expect(text).toContain("hello");
    expect(text).toContain("text-foreground/70");
    expect(text).not.toContain("underline");

    const url = editorHtml("url", { t: "str", v: "https://example.com" });
    expect(url).toContain("https://example.com");
    expect(url).toContain("underline");
    expect(url).toContain("text-primary");
  });

  it("number stringifies whatever it is handed", () => {
    expect(editorHtml("number", { t: "num", v: 42 })).toContain("42");
    // A str on a number field is a mismatch the UI hints at but still shows.
    expect(editorHtml("number", { t: "str", v: "7" })).toContain("7");
  });

  it("date formats an ISO string for display, and opens closed", () => {
    const html = editorHtml("date", { t: "str", v: "2026-03-04" });
    expect(html).toContain("Mar 4, 2026");
    expect(html).not.toContain("<input");
  });

  it("checkbox is a switch, off for anything that is not a true bool", () => {
    expect(editorHtml("checkbox", { t: "bool", v: true })).toContain('aria-pressed="true"');
    expect(editorHtml("checkbox", { t: "bool", v: false })).toContain('aria-pressed="false"');
    expect(editorHtml("checkbox", { t: "str", v: "true" })).toContain('aria-pressed="false"');
  });

  it("a resolved ref renders the target row; an unresolved one warns", () => {
    expect(editorHtml("ref", { t: "ref", v: "n.target" })).toContain("Target one");

    const missing = editorHtml("ref", { t: "ref", v: "n.gone" });
    expect(missing).toContain('data-unresolved-ref="true"');
    expect(missing).toContain("n.gone");

    // A display label makes it a known node rendered by label, not a warning.
    const labelled = editorHtml("ref", { t: "ref", v: "n.gone" }, { display: "Elsewhere" });
    expect(labelled).not.toContain("data-unresolved-ref");
    expect(labelled).toContain("Elsewhere");
  });
});

describe("the empty slot of each type", () => {
  /** What an unset slot shows: the CSS `:empty::before` placeholder, mostly. */
  const EMPTY_MARKER: Record<FieldType, string> = {
    text: 'data-empty-placeholder="true"',
    number: ">0<",
    url: 'data-empty-placeholder="true"',
    date: 'data-empty-placeholder="true"',
    checkbox: 'aria-pressed="false"',
    ref: 'data-ref-slot="closed"',
  };

  for (const fieldType of FIELD_TYPES) {
    it(`${fieldType} starts from its own empty value`, () => {
      expect(emptyHtml(fieldType)).toContain(EMPTY_MARKER[fieldType]);
    });
  }

  it('a ref slot the user minted with "+ value" opens focused', () => {
    const minted = emptyHtml("ref", undefined, true);
    expect(minted).toContain("autofocus");
    expect(minted).not.toContain('data-ref-slot="closed"');
  });

  it("a date slot minted by a gesture opens its native picker", () => {
    expect(emptyHtml("date", undefined, true)).toContain('type="date"');
  });
});

describe("a field may name its own editor, whatever its type says", () => {
  it("sys.f.color takes the swatch editor filled, empty, and in the row icon", () => {
    expect(
      editorHtml("text", { t: "str", v: "#3b82f6" }, { fieldId: SYSTEM_IDS.colorField }),
    ).toContain('data-color-swatch-editor="true"');
    expect(emptyHtml("text", SYSTEM_IDS.colorField)).toContain('data-color-swatch-editor="true"');

    const row = renderToStaticMarkup(
      createElement(FieldRow, {
        label: "color",
        fieldType: "text",
        fieldId: SYSTEM_IDS.colorField,
        children: "value",
      }),
    );
    // The palette glyph, not the text glyph: PaletteIcon's path, matched by the
    // one attribute every phosphor icon renders — the accessible role is bare,
    // so pin the row instead of the SVG internals.
    expect(row).toContain('data-field-row="true"');
    expect(row).toContain("<svg");
  });

  it("the swatch is chosen by field id even when the declared type is ref", () => {
    expect(
      editorHtml("ref", { t: "ref", v: "n.target" }, { fieldId: SYSTEM_IDS.colorField }),
    ).toContain('data-color-swatch-editor="true"');
  });
});

describe("what a commit writes", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let committed: PropValue[];

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
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount(fieldType: FieldType, value: PropValue, fieldId?: string) {
    await act(async () => {
      root.render(
        createElement(PropValueEditor, {
          value,
          display: "",
          fieldType,
          fieldId,
          allowedRefIds: null,
          autoOpen: false,
          onCommit: (next: PropValue) => committed.push(next),
          nodes,
        }),
      );
    });
  }

  const editable = () =>
    present(container.querySelector<HTMLElement>('[data-editable-text="true"]'), "editable");

  async function typeAndBlur(text: string) {
    const el = editable();
    await act(async () => {
      el.click();
    });
    el.textContent = text;
    await act(async () => {
      el.dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
  }

  it("text writes the string it was given", async () => {
    await mount("text", { t: "str", v: "before" });
    await typeAndBlur("after");
    expect(committed).toEqual([{ t: "str", v: "after" }]);
  });

  it("url writes a plain string too — the underline is display only", async () => {
    await mount("url", { t: "str", v: "" });
    await typeAndBlur("https://kb.example");
    expect(committed).toEqual([{ t: "str", v: "https://kb.example" }]);
  });

  it("number coerces to num, and writes nothing when it cannot", async () => {
    await mount("number", { t: "num", v: 1 });
    await typeAndBlur(" 12 ");
    expect(committed).toEqual([{ t: "num", v: 12 }]);

    committed = [];
    await mount("number", { t: "num", v: 1 });
    await typeAndBlur("not a number");
    expect(committed).toEqual([]);
  });

  it("checkbox writes the flipped bool", async () => {
    await mount("checkbox", { t: "bool", v: false });
    const toggle = present(container.querySelector("button"), "checkbox");
    await act(async () => {
      toggle.click();
    });
    expect(committed).toEqual([{ t: "bool", v: true }]);
  });

  it("date offers a native picker seeded from the stored ISO string", async () => {
    // The write itself (`{t:"str"}`, never `{t:"date"}`) is `emptyValueForType`
    // and the picker's own `onChange`; see the blind spot at the top of the file.
    await mount("date", { t: "str", v: "2026-05-06T00:00:00.000Z" });
    const span = present(container.querySelector<HTMLElement>("span.cursor-text"), "date display");
    await act(async () => {
      span.click();
    });
    const input = present(container.querySelector('input[type="date"]'), "date input");
    expect(input.getAttribute("value")).toBe("2026-05-06");
    expect(emptyValueForType("date")).toEqual({ t: "str", v: "" });
  });

  it("ref writes the picked id", async () => {
    await mount("ref", { t: "ref", v: "" });
    const slot = present(container.querySelector('[data-ref-slot="closed"]'), "closed ref slot");
    await act(async () => {
      slot.dispatchEvent(
        new dom.window.FocusEvent("focusin", { bubbles: true }) as unknown as Event,
      );
    });
    const option = present(container.querySelector('[role="option"]'), "first option");
    await act(async () => {
      option.dispatchEvent(
        new dom.window.MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
    expect(committed).toEqual([{ t: "ref", v: "n.target" }]);
  });

  it("ref offers the search itself, not a closed field, once it is open", async () => {
    // Manual entry ("commit the raw query when nothing matched") needs a typed
    // input; see the blind spot at the top of the file. What is observable here
    // is that the open state is a search box with its own placeholder.
    await mount("ref", { t: "ref", v: "" });
    const slot = present(container.querySelector('[data-ref-slot="closed"]'), "closed ref slot");
    await act(async () => {
      slot.dispatchEvent(
        new dom.window.FocusEvent("focusin", { bubbles: true }) as unknown as Event,
      );
    });
    const input = present(container.querySelector("input"), "ref input");
    expect(input.getAttribute("placeholder")).toBe("Search node\u2026");
    expect(committed).toEqual([]);
  });

  it("the color swatch writes the hex it was clicked on", async () => {
    await mount("text", { t: "str", v: "" }, SYSTEM_IDS.colorField);
    const swatch = present(
      container.querySelector<HTMLElement>("[aria-label^='Set color ']"),
      "swatch",
    );
    const hex = present(swatch.getAttribute("aria-label"), "label").replace("Set color ", "");
    await act(async () => {
      swatch.click();
    });
    expect(committed).toEqual([{ t: "str", v: hex }]);
  });
});

describe("ref candidate keyboard navigation", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let committed: PropValue[];

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
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function openPicker() {
    await act(async () => {
      root.render(
        createElement(PropValueEditor, {
          value: { t: "ref", v: "" },
          display: "",
          fieldType: "ref" as const,
          allowedRefIds: null,
          autoOpen: true,
          onCommit: (next: PropValue) => committed.push(next),
          nodes,
        }),
      );
    });
    return present(container.querySelector("input"), "ref input");
  }

  async function press(input: HTMLInputElement, key: string) {
    await act(async () => {
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
  }

  const selected = () =>
    [...container.querySelectorAll('[role="option"]')].findIndex(
      (el) => el.getAttribute("aria-selected") === "true",
    );

  it("opens with the first candidate active", async () => {
    await openPicker();
    expect(selected()).toBe(0);
  });

  it("ArrowDown and ArrowUp wrap around the list", async () => {
    const input = await openPicker();
    const count = container.querySelectorAll('[role="option"]').length;
    expect(count).toBe(2);

    await press(input, "ArrowDown");
    expect(selected()).toBe(1);
    await press(input, "ArrowDown");
    expect(selected()).toBe(0);
    await press(input, "ArrowUp");
    expect(selected()).toBe(1);
  });

  it("Enter commits the active candidate", async () => {
    const input = await openPicker();
    await press(input, "ArrowDown");
    await press(input, "Enter");
    expect(committed).toEqual([{ t: "ref", v: "n.other" }]);
  });

  it("Escape closes without committing", async () => {
    const input = await openPicker();
    await press(input, "Escape");
    expect(committed).toEqual([]);
    expect(container.querySelectorAll('[role="listbox"]').length).toBe(0);
  });

  it("keys never reach the outline row behind the picker", async () => {
    let leaked = 0;
    await act(async () => {
      root.render(
        createElement(
          "div",
          {
            onKeyDown: () => {
              leaked += 1;
            },
          },
          createElement(PropValueEditor, {
            value: { t: "ref", v: "" },
            display: "",
            fieldType: "ref" as const,
            allowedRefIds: null,
            autoOpen: true,
            onCommit: () => undefined,
            nodes,
          }),
        ),
      );
    });
    const input = present(container.querySelector("input"), "ref input");
    await press(input, "ArrowDown");
    expect(leaked).toBe(0);
  });
});
