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
import type { WireNode } from "@kb/contracts";
import { isPinned } from "@/lib/pinned";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { NodeCommandPalette } from "./node-command-palette";

const ISO = "2026-08-08T05:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

/** A plain row, a supertag, and the pinned tag. */
function graph(): WireNode[] {
  return [
    wire({ id: SYSTEM_IDS.tag, text: "sys.tag" }),
    wire({ id: "n.plain", text: "Plain node" }),
    wire({
      id: "t.super",
      text: "project",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    }),
    wire({
      id: "tag.pinned",
      text: "pinned",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    }),
  ];
}

function seed() {
  useOutlineStore.setState({
    nodes: new Map(),
    wireNodes: [],
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    cursorPosition: 0,
    loadSource: null,
    loadError: null,
    undoStack: [],
    redoStack: [],
  });
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
    [...dom.document.querySelectorAll('[data-palette-list="true"] button')].map(
      (b) => b.textContent?.trim() ?? "",
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
      (b) => b.textContent?.trim() === "Pin",
    ) as HTMLElement | undefined;
    expect(pin).toBeTruthy();
    await act(async () => {
      pin!.click();
    });
    const nodes = useOutlineStore.getState().nodes;
    expect(isPinned(nodes.get("n.plain"), nodes)).toBe(true);

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
});
