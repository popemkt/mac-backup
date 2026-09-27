/**
 * The field picker: the one node picker as a field's values are chosen with
 * it. Pinned through a fake `FieldHandle`, so what is asserted is what the
 * picker asks of the field — add, remove, create, replace — not a store.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { DatascriptIndex } from "@/ds";
import { fieldTypeValue } from "@/lib/field-type";
import { wireToOutlineMap } from "@/lib/graph-view";
import type { RefCreation } from "@/lib/refs";
import { fieldContextOf, type FieldContext } from "@/lib/schema";
import { SYSTEM_IDS, type PropValue } from "@/lib/types";
import { FieldPicker, type FieldHandle } from "./field-picker";

const ISO = "2026-09-28T00:00:00.000Z";
const wire = (partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode => ({
  props: {},
  children: [],
  createdAt: ISO,
  updatedAt: ISO,
  ...partial,
});

const GRAPH: WireNode[] = [
  wire({
    id: "f.status",
    text: "status",
    children: ["opt.todo", "opt.doing", "opt.done"],
    props: { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")] },
  }),
  wire({ id: "opt.todo", text: "Todo" }),
  wire({ id: "opt.doing", text: "Doing" }),
  wire({ id: "opt.done", text: "Done" }),
  wire({
    id: "f.picked",
    text: "picked",
    props: {
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
      [SYSTEM_IDS.targetQueryField]: [
        { t: "str", v: '[:find ?id :where [?n :node/id ?id] [?n :node/text "Alpha"]]' },
      ],
    },
  }),
  wire({ id: "n.alpha", text: "Alpha" }),
];

const show = (v: PropValue) => (v.t === "ref" ? v.v : JSON.stringify(v));

function contextOf(graph: WireNode[]): FieldContext {
  return fieldContextOf({
    ontologyId: null,
    nodes: wireToOutlineMap(graph, new Set()),
    wireNodes: [],
    index: new DatascriptIndex(graph),
  });
}

describe("FieldPicker", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let calls: string[];
  let closed: number;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    calls = [];
    closed = 0;
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function handle(values: PropValue[], many: boolean): FieldHandle {
    return {
      values,
      many,
      add: (v) => calls.push(`add ${show(v)}`),
      remove: (v) => calls.push(`remove ${show(v)}`),
      create: async (creation: RefCreation, name: string) => {
        calls.push(`create ${creation.kind} ${name}`);
        return "n.new";
      },
      openPicker: () => undefined,
      addSlot: () => undefined,
      leave: () => undefined,
      claimKeyboard: () => undefined,
      focusSlot: () => undefined,
    };
  }

  /**
   * Open the picker, with a query already typed when given — the query a
   * keystroke on a value at rest starts it with. (React's `onChange` does not
   * fire for an `<input>` under happy-dom, so typing itself is not driven.)
   */
  async function open(fieldId: string, field: FieldHandle, initialQuery = "") {
    await act(async () => {
      root.render(
        createElement(FieldPicker, {
          fieldId,
          context: contextOf(GRAPH),
          field,
          initialQuery,
          onReplace: (id: string) => calls.push(`replace ${id}`),
          onClose: () => (closed += 1),
        }),
      );
    });
    return present(container.querySelector("input"), "picker input");
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

  const rows = () =>
    [...container.querySelectorAll('[role="option"]')].map((o) => ({
      text: o.textContent,
      checked: o.getAttribute("aria-checked"),
      active: o.getAttribute("aria-selected") === "true",
    }));

  it("offers an option set in its own order, what is picked checked", async () => {
    await open("f.status", handle([{ t: "ref", v: "opt.done" }], true));
    expect(rows()).toEqual([
      { text: "Todo", checked: "false", active: true },
      { text: "Doing", checked: "false", active: false },
      { text: "Done", checked: "true", active: false },
    ]);
  });

  it("filters fuzzily, marks what matched, and offers to create the rest", async () => {
    await open("f.status", handle([], true), "do");
    const marks = [...container.querySelectorAll('[data-picker-match="true"]')].map(
      (m) => m.textContent,
    );
    expect(rows().map((r) => r.text)).toEqual(["Doing", "Done", "Todo", "Create option “do”"]);
    expect(marks.slice(0, 2)).toEqual(["Do", "Do"]);
  });

  it("in a many-valued field Enter toggles and the picker stays open", async () => {
    const input = await open("f.status", handle([{ t: "ref", v: "opt.todo" }], true));
    await press(input, "Enter");
    await press(input, "ArrowDown");
    await press(input, "Enter");
    expect(calls).toEqual(["remove opt.todo", "add opt.doing"]);
    expect(closed).toBe(0);
  });

  it("Backspace on an empty query takes back the last value", async () => {
    const input = await open(
      "f.status",
      handle(
        [
          { t: "ref", v: "opt.todo" },
          { t: "ref", v: "opt.done" },
        ],
        true,
      ),
    );
    await press(input, "Backspace");
    expect(calls).toEqual(["remove opt.done"]);
  });

  it("in a single-valued field a pick replaces the value", async () => {
    const input = await open("f.status", handle([{ t: "ref", v: "opt.todo" }], false));
    await press(input, "ArrowDown");
    await press(input, "Enter");
    expect(calls).toEqual(["replace opt.doing"]);
  });

  it("creates the query as a new option under the field, then picks it", async () => {
    const input = await open("f.status", handle([], true), "Blocked");
    expect(rows().at(-1)?.text).toBe("Create option “Blocked”");
    await press(input, "ArrowUp");
    await act(async () => {
      await press(input, "Enter");
    });
    expect(calls).toEqual(["create child Blocked", "add n.new"]);
  });

  it("offers no create for a field whose targets are a query", async () => {
    await open("f.picked", handle([], true));
    expect(rows().map((r) => r.text)).toEqual(["Alpha"]);
    await act(async () => root.render(null));
    await open("f.picked", handle([], true), "Beta");
    expect(rows()).toEqual([]);
    expect(container.textContent).toContain("No matches");
  });

  it("Escape closes it", async () => {
    const input = await open("f.status", handle([], true));
    await press(input, "Escape");
    expect(closed).toBe(1);
  });
});
