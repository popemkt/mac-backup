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
import {
  DatascriptIndex,
  fieldContextOf,
  fieldTypeValue,
  SYSTEM_IDS,
  TAG_PALETTE,
  wireToOutlineMap,
  type FollowHow,
  type FollowTarget,
  type NodeMap,
  type PropValue,
} from "@kb/ui-sdk";
import { FieldValueStack } from "./fields-section";
import { renderToStaticMarkup } from "react-dom/server";
import type { WireNode } from "@kb/contracts";
import { stubOutlineNode } from "@/catalog/fixtures";
import { formatNumber, numberEditText } from "@/lib/number-format";
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

  it("a modified key at rest is the app's, not the slot's", async () => {
    await mount({ t: "str", v: "before" });
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
    expect(leaked).toBe(1);
  });
});

describe("ValueSlot follows like a link", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let followed: Array<[FollowTarget, FollowHow]>;

  const nodes: NodeMap = new Map([
    ["n.target", stubOutlineNode({ id: "n.target", text: "Target one" })],
  ]);
  const refContext = fieldContextOf({ ontologyId: null, nodes, wireNodes: [], index: null });

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    followed = [];
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mountRef() {
    await act(async () => {
      root.render(
        createElement(ValueSlot, {
          value: { t: "ref", v: "n.target" },
          fieldType: "ref",
          fieldId: "f.link",
          context: refContext,
          onCommit: () => undefined,
          onFollow: (target: FollowTarget, how: FollowHow) => followed.push([target, how]),
        }),
      );
    });
    return present(container.querySelector<HTMLElement>('[data-value-slot="ref"]'), "slot");
  }

  function clickOn(el: Element, init: { metaKey?: boolean } = {}) {
    return act(async () => {
      el.dispatchEvent(
        new dom.window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ...init,
        }) as unknown as Event,
      );
    });
  }

  it("a plain click on the target's label follows it, as a [[ref]] pill does", async () => {
    await mountRef();
    const label = present(container.querySelector("[data-kb-ref-id]"), "label");
    await clickOn(label);
    expect(followed).toEqual([[{ kind: "node", id: "n.target" }, "open"]]);
    expect(container.querySelector("input")).toBeNull();
  });

  it("a plain click beside the label edits the value", async () => {
    const slot = await mountRef();
    const row = present(slot.querySelector('[data-node-row="true"]'), "row");
    await clickOn(row);
    expect(followed).toEqual([]);
    expect(container.querySelector("input")).not.toBeNull();
  });

  it("a modifier click anywhere on the value follows it", async () => {
    const slot = await mountRef();
    const row = present(slot.querySelector('[data-node-row="true"]'), "row");
    await clickOn(row, { metaKey: true });
    expect(followed).toEqual([[{ kind: "node", id: "n.target" }, "open"]]);
    expect(container.querySelector("input")).toBeNull();
  });
});

describe("a url value is a link", () => {
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

  async function mountUrl(v: string) {
    await act(async () => {
      root.render(
        createElement(ValueSlot, {
          value: { t: "str", v },
          fieldType: "url",
          fieldId: "f.site",
          context,
          onCommit: (next: PropValue) => committed.push(next),
          onFollow: () => undefined,
        }),
      );
    });
    return present(container.querySelector<HTMLElement>('[data-value-slot="url"]'), "slot");
  }

  const editable = () =>
    present(container.querySelector<HTMLElement>('[data-editable-text="true"]'), "editable");

  async function typeAndLeave(text: string) {
    editable().textContent = text;
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
  }

  it("shows a short label on a real anchor, the full url as its title", async () => {
    await mountUrl("https://www.kb.example/docs/");
    const link = present(container.querySelector("a.kb-md-link"), "link");
    expect(link.getAttribute("href")).toBe("https://www.kb.example/docs/");
    expect(link.getAttribute("title")).toBe("https://www.kb.example/docs/");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toBe("kb.example/docs");
  });

  it("a click on the link opens it; a click beside it edits the raw url", async () => {
    const slot = await mountUrl("https://kb.example/a");
    await act(async () => {
      present(container.querySelector<HTMLElement>("a.kb-md-link"), "link").click();
    });
    expect(slot.getAttribute("data-editing")).toBeNull();
    await act(async () => {
      editable().click();
    });
    expect(slot.getAttribute("data-editing")).toBe("true");
    expect(container.querySelector("a.kb-md-link")).toBeNull();
    expect(editable().textContent).toBe("https://kb.example/a");
  });

  it("writes a bare host as the link it names", async () => {
    const slot = await mountUrl("");
    await act(async () => {
      slot.click();
    });
    await typeAndLeave("kb.example/x");
    expect(committed).toEqual([{ t: "str", v: "https://kb.example/x" }]);
  });

  it("keeps input that is not a link, marked, instead of dropping it", async () => {
    const slot = await mountUrl("https://kb.example");
    await act(async () => {
      slot.click();
    });
    await typeAndLeave("javascript:alert(1)");
    expect(committed).toEqual([]);
    const shown = editable();
    expect(shown.getAttribute("data-rejected")).toBe("true");
    expect(shown.textContent).toBe("javascript:alert(1)");
    expect(shown.getAttribute("title")).toContain("not a link");
    expect(container.querySelector('[data-mismatch-warning="true"]')).not.toBeNull();

    // Escape while editing puts the stored value back and drops the mark.
    await act(async () => {
      slot.click();
    });
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
    expect(editable().getAttribute("data-rejected")).toBeNull();
    expect(committed).toEqual([]);
  });
});

describe("a text value is node text", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let committed: PropValue[];
  let followed: FollowTarget[];

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
    followed = [];
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mountText(v: string) {
    await act(async () => {
      root.render(
        createElement(ValueSlot, {
          value: { t: "str", v },
          fieldType: "text",
          fieldId: "f.note",
          context,
          onCommit: (next: PropValue) => committed.push(next),
          onFollow: (target: FollowTarget) => followed.push(target),
        }),
      );
    });
    return present(container.querySelector<HTMLElement>('[data-value-slot="text"]'), "slot");
  }

  const editable = () =>
    present(container.querySelector<HTMLElement>('[data-editable-text="true"]'), "editable");

  async function key(k: string, init: { shiftKey?: boolean } = {}) {
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
          ...init,
        }) as unknown as Event,
      );
    });
  }

  async function leave() {
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
  }

  it("renders its inline markdown at rest: formatting and ref pills", async () => {
    await mountText("**bold** and [[n.x|X]]");
    expect(editable().querySelector("strong")?.textContent).toBe("bold");
    expect(editable().querySelector("[data-kb-ref-id]")?.getAttribute("data-kb-ref-id")).toBe(
      "n.x",
    );
  });

  it("a click on a ref pill follows it rather than editing", async () => {
    const slot = await mountText("see [[n.x|X]]");
    await act(async () => {
      present(container.querySelector<HTMLElement>("[data-kb-ref-id]"), "pill").click();
    });
    expect(followed).toEqual([{ kind: "node", id: "n.x" }]);
    expect(slot.getAttribute("data-editing")).toBeNull();
  });

  it("edits over the same tree, and writes the markdown back byte for byte", async () => {
    const slot = await mountText("a **b** [[n.x|X]]");
    await act(async () => {
      slot.click();
    });
    // The editor holds the same inline tree: the pill is still a pill.
    expect(editable().getAttribute("contenteditable")).toBe("true");
    expect(editable().querySelector("[data-kb-ref-id]")).not.toBeNull();
    await leave();
    expect(committed).toEqual([]);
  });

  it("Shift+Enter breaks the line inside the value", async () => {
    const slot = await mountText("one");
    await act(async () => {
      slot.click();
    });
    await key("Enter", { shiftKey: true });
    await leave();
    expect(committed).toEqual([{ t: "str", v: "one\n" }]);
  });
});

describe("a number value reads in the locale", () => {
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

  async function mountNumber(v: number) {
    await act(async () => {
      root.render(
        createElement(ValueSlot, {
          value: { t: "num", v },
          fieldType: "number",
          fieldId: "f.estimate",
          context,
          onCommit: (next: PropValue) => committed.push(next),
          onFollow: () => undefined,
        }),
      );
    });
    return present(container.querySelector<HTMLElement>('[data-value-slot="number"]'), "slot");
  }

  const editable = () =>
    present(container.querySelector<HTMLElement>('[data-editable-text="true"]'), "editable");

  async function typeAndLeave(text: string) {
    editable().textContent = text;
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
  }

  it("shows the number grouped, and edits it ungrouped", async () => {
    const slot = await mountNumber(1234567.5);
    expect(editable().textContent).toBe(formatNumber(1234567.5));
    expect(editable().className).toContain("tabular-nums");
    await act(async () => {
      slot.click();
    });
    expect(editable().textContent).toBe(numberEditText(1234567.5));
  });

  it("reads typing in the locale's separators, grouping ignored", async () => {
    const slot = await mountNumber(1);
    await act(async () => {
      slot.click();
    });
    await typeAndLeave(formatNumber(12345.5));
    expect(committed).toEqual([{ t: "num", v: 12345.5 }]);
  });

  it("keeps input that is no number, marked, and commits nothing", async () => {
    const slot = await mountNumber(1);
    await act(async () => {
      slot.click();
    });
    await typeAndLeave("12 apples");
    expect(committed).toEqual([]);
    expect(editable().getAttribute("data-rejected")).toBe("true");
    expect(editable().textContent).toBe("12 apples");
  });
});

describe("a checkbox value", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let committed: PropValue[];

  const boxField = stubOutlineNode({
    id: "f.done",
    text: "done",
    props: { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("checkbox")] },
  });
  const boxContext = fieldContextOf({
    ontologyId: null,
    nodes: new Map([["f.done", boxField]]),
    wireNodes: [],
    index: null,
  });

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

  it("is a real checkbox the slot toggles", async () => {
    await act(async () => {
      root.render(
        createElement(ValueSlot, {
          value: { t: "bool", v: false },
          fieldType: "checkbox",
          fieldId: "f.done",
          context: boxContext,
          onCommit: (next: PropValue) => committed.push(next),
          onFollow: () => undefined,
        }),
      );
    });
    const box = present(container.querySelector<HTMLElement>('[role="checkbox"]'), "checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      box.click();
    });
    expect(committed).toEqual([{ t: "bool", v: true }]);
  });

  it("holds one value by its type, so its field offers no second one", async () => {
    await act(async () => {
      root.render(
        createElement(FieldValueStack, {
          nodeId: "n.task",
          fieldId: "f.done",
          fieldType: "checkbox",
          values: [{ t: "bool", v: true }],
          context: boxContext,
          readOnly: false,
          onFollow: () => undefined,
        }),
      );
    });
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent.trim() === "value"),
    ).toBe(false);
  });
});

describe("an option value is a chip", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let followed: FollowTarget[];

  const ISO = "2026-09-28T00:00:00.000Z";
  const optionWire: WireNode[] = [
    {
      id: "f.status",
      text: "status",
      children: ["opt.todo", "opt.done"],
      props: { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")] },
      createdAt: ISO,
      updatedAt: ISO,
    },
    { id: "opt.todo", text: "Todo", children: [], props: {}, createdAt: ISO, updatedAt: ISO },
    {
      id: "opt.done",
      text: "Done",
      children: [],
      props: { [SYSTEM_IDS.colorField]: [{ t: "str", v: "#22c55e" }] },
      createdAt: ISO,
      updatedAt: ISO,
    },
  ];
  // The option set is the field's children, a declaration resolved by query.
  const optionContext = fieldContextOf({
    ontologyId: null,
    nodes: wireToOutlineMap(optionWire, new Set()),
    wireNodes: [],
    index: new DatascriptIndex(optionWire),
  });

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    followed = [];
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mountStack(values: PropValue[]) {
    await act(async () => {
      root.render(
        createElement(FieldValueStack, {
          nodeId: "n.task",
          fieldId: "f.status",
          fieldType: "ref",
          values,
          context: optionContext,
          readOnly: false,
          onFollow: (target: FollowTarget) => followed.push(target),
        }),
      );
    });
  }

  it("draws each option as a chip in its colour, and the chips wrap on one line", async () => {
    await mountStack([
      { t: "ref", v: "opt.done" },
      { t: "ref", v: "opt.todo" },
    ]);
    const stack = present(container.querySelector('[data-field-values="f.status"]'), "stack");
    expect(stack.getAttribute("data-layout")).toBe("inline");
    const chips = [...container.querySelectorAll<HTMLElement>('[data-option-chip="true"]')];
    expect(chips.map((c) => c.textContent)).toEqual(["Done", "Todo"]);
    // Its own colour, else its place among the field's options (the palette's
    // first slot for the field's first child). Read from the markup: the DOM
    // here drops `color-mix` styles it cannot parse.
    const html = renderToStaticMarkup(
      createElement(FieldValueStack, {
        nodeId: "n.task",
        fieldId: "f.status",
        fieldType: "ref",
        values: [
          { t: "ref", v: "opt.done" },
          { t: "ref", v: "opt.todo" },
        ],
        context: optionContext,
        readOnly: false,
        onFollow: () => undefined,
      }),
    );
    expect(html).toContain("#22c55e");
    expect(html).toContain(TAG_PALETTE[0]);
  });

  it("a click on the chip follows it; a click beside it opens the picker", async () => {
    await mountStack([{ t: "ref", v: "opt.done" }]);
    await act(async () => {
      present(container.querySelector<HTMLElement>('[data-option-chip="true"]'), "chip").click();
    });
    expect(followed).toEqual([{ kind: "node", id: "opt.done" }]);
    const slot = present(
      container.querySelector<HTMLElement>('[data-value-slot="option"]'),
      "slot",
    );
    await act(async () => {
      slot.click();
    });
    // The picker keeps the field's own order of its options.
    const offered = [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(offered).toEqual(["Todo", "Done"]);
  });
});
