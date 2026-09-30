/**
 * A projected view under an ontology scope reads its schema from the whole
 * graph. The field, its options and the tag are not members; the frame and its
 * row are. Rendered through FrameViewSlot, the way the outline renders a
 * table or board frame, with nothing handed in but the frame id — so every
 * schema read goes through the store's `schemaOf`, as in production.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncUiPlugins } from "@/lib/plugins";
import { FrameViewSlot } from "./frame-view-slot";
import { outlineUiPlugin } from "./plugin";
import { framedAs, type FrameViewName } from "@/fixtures/view-fields";

/** A frame view and the settings its view node carries. */
type FramedView = readonly [FrameViewName, WireNode["props"]];

const ISO = "2026-09-26T00:00:00.000Z";
const TAG = "t.svc";

function node(
  id: string,
  text: string,
  props: WireNode["props"] = {},
  children: string[] = [],
): WireNode {
  return { id, text, props, children, createdAt: ISO, updatedAt: ISO };
}

const tagged = { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: TAG }] };

function wire([view, settings]: FramedView): WireNode[] {
  return [
    node(TAG, "service", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] }),
    node(
      "f.status",
      "status",
      {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: SYSTEM_IDS.ftRef }],
        [SYSTEM_IDS.cardinalityField]: [{ t: "ref", v: SYSTEM_IDS.cardinalityOne }],
      },
      ["opt.open", "opt.done"],
    ),
    node("opt.open", "Open"),
    node("opt.done", "Done"),
    node("f.link", "link", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: SYSTEM_IDS.ftRef }],
    }),
    ...framedAs(node("frame", "Services", tagged, ["row"]), view, settings),
    node("row", "alpha", { ...tagged, "f.status": [{ t: "ref", v: "opt.done" }] }),
    node("outsider", "outsider"),
    node("o.1", "Services ontology", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
      [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: TAG }],
    }),
  ];
}

const TABLE: FramedView = [
  "table",
  {
    [SYSTEM_IDS.viewDisplayField]: [
      { t: "ref" as const, v: "f.status" },
      { t: "ref" as const, v: "f.link" },
    ],
  },
];
const BOARD: FramedView = [
  "board",
  {
    [SYSTEM_IDS.viewGroupField]: [{ t: "ref" as const, v: "f.status" }],
    [SYSTEM_IDS.viewDisplayField]: [{ t: "ref" as const, v: "f.status" }],
  },
];
const CARDS: FramedView = [
  "cards",
  {
    [SYSTEM_IDS.viewDisplayField]: [{ t: "ref" as const, v: "f.status" }],
  },
];

/** Each option shows its label (and its id beside it): both non-members. */
function expectTheOptionSet(offered: string[]): void {
  expect(offered).toHaveLength(2);
  expect(offered.some((t) => t.startsWith("Done"))).toBe(true);
  expect(offered.some((t) => t.startsWith("Open"))).toBe(true);
}

describe("a projected view under an ontology scope", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.FocusEvent = dom.FocusEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
    // The slot draws the frame's view from the ones the outline plugin provides.
    syncUiPlugins([outlineUiPlugin]);
  });

  afterAll(() => {
    syncUiPlugins([]);
  });

  beforeEach(() => {
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderScoped(view: FramedView) {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(wire(view), 1, "fixtures");
    useOutlineStore.getState().setOntologyScope("o.1");
    const scoped = useOutlineStore.getState();
    // The premise: the schema is not in the projection.
    expect(scoped.nodes.has("f.status")).toBe(false);
    expect(scoped.nodes.has("opt.done")).toBe(false);
    expect(scoped.nodes.has("frame")).toBe(true);
    await act(async () => {
      root.render(<FrameViewSlot frameId="frame" depth={0} />);
    });
  }

  it("a table column names its field, types the cell and labels the option", async () => {
    await renderScoped(TABLE);
    const header = present(container.querySelector("thead"), "table header");
    expect(header.textContent).toContain("status");
    // An option cell renders the resolved option as its chip, not a text editor.
    const cell = present(
      container.querySelector('tbody [data-option-chip="true"][data-kb-ref-id="opt.done"]'),
      "the option rendered as a resolved option chip",
    );
    expect(cell.textContent).toContain("Done");
  });

  /** Open the picker on the rendered "Done" value, and return what it offers. */
  async function pickerOnDone(): Promise<string[]> {
    const label = present(
      [...container.querySelectorAll("span")].find((s) => s.textContent === "Done"),
      "option label",
    );
    // The label itself is a pointer (it follows); the slot around it edits.
    const slot = present(label.closest<HTMLElement>("[data-value-slot]"), "value slot");
    await act(async () => {
      slot.click();
    });
    const listbox = present(container.querySelector('[role="listbox"]'), "ref picker");
    return [...listbox.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  }

  it("the table cell's picker offers the field's option set", async () => {
    await renderScoped(TABLE);
    expectTheOptionSet(await pickerOnDone());
  });

  it("a board card's picker offers the field's option set", async () => {
    await renderScoped(BOARD);
    expectTheOptionSet(await pickerOnDone());
  });

  it("a card's picker offers the field's option set", async () => {
    await renderScoped(CARDS);
    expectTheOptionSet(await pickerOnDone());
  });

  it("a board groups by the option's label and names the empty column from the field", async () => {
    await renderScoped(BOARD);
    const text = container.textContent;
    expect(text).toContain("Done");
    expect(text).toContain("No status");
    expect(text).not.toContain("opt.done");
  });

  it("an unconstrained ref field searches the scope: members only", async () => {
    await renderScoped(TABLE);
    const slot = present(
      container.querySelector('[data-ref-slot="closed"]'),
      "the empty link slot",
    ) as HTMLElement;
    await act(async () => {
      slot.dispatchEvent(new dom.FocusEvent("focusin", { bubbles: true }) as unknown as Event);
    });
    const listbox = present(container.querySelector('[role="listbox"]'), "ref picker");
    const offered = [...listbox.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(offered.some((t) => t.startsWith("alpha"))).toBe(true);
    // Not members: an ordinary outsider, the options, the field and the tag.
    for (const outside of ["outsider", "Open", "Done", "status", "service"]) {
      expect(offered.some((t) => t.startsWith(outside))).toBe(false);
    }
  });
});
