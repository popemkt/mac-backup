/**
 * The node ⌘K menu must not lie about the node it is pointed at.
 *
 * `isTag` was `targetNode.tags.some(t => t.id === "sys.tag")`, and `resolveTags`
 * never emits `sys.tag` (a "#tag" chip on a tag's own page is nonsense), so the
 * flag was permanently false and "Make supertag" was offered on nodes that
 * already were supertags. Same rule as everywhere else: read the kind slot.
 *
 * The pin and debug rows are toggles, so their labels are asserted in both
 * states — a command whose label does not move is indistinguishable from one
 * that did nothing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { REF_SEED_WIRES, ctxRefWire } from "@/fixtures/contextual-ref";
import { isPinned } from "@/lib/pinned";
import { SYSTEM_IDS } from "@/lib/types";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { NodeCommandPalette } from "./node-command-palette";

const ISO = "2026-08-08T05:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

/** A plain row, a supertag, and the seed the pin gesture writes through. */
function graph(): WireNode[] {
  return [
    wire({ id: SYSTEM_IDS.tag, text: "sys.tag" }),
    wire({ id: "n.plain", text: "Plain node" }),
    wire({
      id: "t.super",
      text: "project",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    }),
    ...REF_SEED_WIRES,
    wire({ id: SYSTEM_IDS.pinnedRoot, text: "Pinned" }),
    wire({
      id: "n.query",
      text: "A saved query",
      props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: "[:find ?e :where [?e]]" }] },
    }),
    ctxRefWire("n.ref", "n.plain"),
  ];
}

function seed() {
  resetOutlineStore();
  useOutlineStore.getState().hydrateFromWire(graph(), 1, "fixtures");
  useDebugFieldsStore.setState({ ids: new Set() });
}

describe("node command palette", () => {
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
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
    g.requestAnimationFrame = (fn: () => void) => {
      fn();
      return 0;
    };
  });

  beforeEach(() => {
    seed();
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    dom.document.body.innerHTML = "";
  });

  /** The anchor the palette measures: a row with the node's id. */
  function anchor(nodeId: string) {
    const row = dom.document.createElement("div");
    row.setAttribute("data-node-id", nodeId);
    const inner = dom.document.createElement("div");
    inner.className = "node-row";
    row.appendChild(inner);
    dom.document.body.appendChild(row);
  }

  async function open(nodeId: string) {
    anchor(nodeId);
    useOutlineStore.setState({ selectedNodeId: nodeId });
    await act(async () => {
      root.render(<NodeCommandPalette open onClose={() => {}} />);
    });
  }

  const labels = () =>
    [...dom.document.querySelectorAll('[data-palette-list="true"] button')].map((b) =>
      b.textContent.trim(),
    );

  it("offers Make supertag on a plain node", async () => {
    await open("n.plain");
    expect(labels()).toContain("Make supertag");
  });

  it("does not offer Make supertag on a node that already is one", async () => {
    await open("t.super");
    expect(labels()).not.toContain("Make supertag");
  });

  it("labels the pin row from the node's current state", async () => {
    await open("n.plain");
    expect(labels()).toContain("Pin");
    expect(labels()).not.toContain("Unpin");
  });

  it("pins through the palette and flips the label", async () => {
    await open("n.plain");
    const pin = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
      (b) => b.textContent.trim() === "Pin",
    ) as HTMLElement | undefined;
    await act(async () => {
      present(pin, "pin").click();
    });
    const nodes = useOutlineStore.getState().nodes;
    expect(isPinned(nodes, "n.plain")).toBe(true);

    await open("n.plain");
    expect(labels()).toContain("Unpin");
  });

  it("labels the debug row from this node's own flag", async () => {
    await open("n.plain");
    expect(labels()).toContain("Show debug fields");

    act(() => useDebugFieldsStore.getState().toggle("n.plain"));
    await open("n.plain");
    expect(labels()).toContain("Hide debug fields");

    // A sibling is untouched — the flag is per node, not global.
    await open("t.super");
    expect(labels()).toContain("Show debug fields");
  });

  /**
   * The command set a node offers, in order (closed gaps
   * [[01M1MGCF0ECBDEPTHPKMSQ4YFD]] / [[01M1MGCRNVNBE5HW27Z83PK67B]]).
   *
   * Pinned as whole ordered lists rather than `toContain` checks: assembly by
   * splice makes position a function of which conditions fired, and that
   * ordering is the part a registry has to reproduce.
   */
  it("lists every command a plain node offers, in order", async () => {
    await open("n.plain");
    expect(labels()).toEqual([
      "Add tag",
      "Turn into query",
      "Turn into reference…",
      "Add field",
      "Make supertag",
      "Search everything… ⌘S",
      "Indent",
      "Outdent",
      "Pin",
      "Show debug fields",
      "Delete node",
      "View as: List",
      "View as: Table",
      "View as: Board",
      "View as: Cards",
      "Filter…",
    ]);
  });

  it("drops Make supertag on a supertag, keeping the rest in order", async () => {
    await open("t.super");
    expect(labels()).toEqual([
      "Add tag",
      "Turn into query",
      "Turn into reference…",
      "Add field",
      "Search everything… ⌘S",
      "Indent",
      "Outdent",
      "Pin",
      "Show debug fields",
      "Delete node",
      "View as: List",
      "View as: Table",
      "View as: Board",
      "View as: Cards",
      "Filter…",
    ]);
  });

  it("drops Turn into query on a node that already is one", async () => {
    await open("n.query");
    expect(labels()).not.toContain("Turn into query");
    expect(labels()[1]).toBe("Turn into reference…");
  });

  it("drops Turn into reference on a node that already is one", async () => {
    await open("n.ref");
    expect(labels()).not.toContain("Turn into reference…");
    expect(labels()[1]).toBe("Turn into query");
  });

  it("Add tag opens the tag picker step", async () => {
    await open("n.plain");
    const row = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
      (b) => b.textContent.trim() === "Add tag",
    ) as HTMLElement | undefined;
    await act(async () => {
      present(row, "add tag row").click();
    });
    const input = dom.document.querySelector('[role="dialog"] input') as unknown as
      | HTMLInputElement
      | undefined;
    expect(present(input, "picker input").placeholder).toBe("Search or name a tag...");
    expect(dom.document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Add tag",
    );
  });
});
