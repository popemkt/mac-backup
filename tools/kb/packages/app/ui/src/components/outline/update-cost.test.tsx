/**
 * What a graph update costs the outline: work proportional to what changed,
 * not to how many rows are on screen.
 *
 * - A one-node change re-renders that node's row, not every row: rows read
 *   the graph through `useGraphRead` (`stores/graph-read.ts`).
 * - Expanding or collapsing re-renders the toggled row and mounts or unmounts
 *   its subtree; its siblings stay as they were.
 * - Moving the selection re-renders the two rows it moves between.
 * - No row asks for `[[` candidates while no popup is open.
 *
 * A row render is counted where every row render passes: its chrome
 * (`resolveRowChrome`), keyed by the row's instance.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isQueryNode, systemSeedNodes } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { nodeCandidates } from "@/lib/refs";
import type * as Refs from "@/lib/refs";
import { resolveRowChrome } from "@/lib/row-chrome";
import type * as RowChrome from "@/lib/row-chrome";
import { outlineInstanceKey } from "@/lib/instance-key";
import { syncUiPlugins } from "@/lib/plugins";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { useOutlineStore } from "@/stores/outline.store";
import { outlineUiPlugin } from "./plugin";
import { FrameViewSlot } from "./frame-view-slot";

vi.mock("@/lib/refs", async (importOriginal) => {
  const actual = await importOriginal<typeof Refs>();
  return { ...actual, nodeCandidates: vi.fn(actual.nodeCandidates) };
});

vi.mock("@/lib/row-chrome", async (importOriginal) => {
  const actual = await importOriginal<typeof RowChrome>();
  return { ...actual, resolveRowChrome: vi.fn(actual.resolveRowChrome) };
});

const ISO = "2026-08-08T05:00:00.000Z";
const CHILDREN = 40;

function wire(id: string, text: string, children: string[] = []): WireNode {
  return { id, text, props: {}, children, createdAt: ISO, updatedAt: ISO };
}

/**
 * One parent with many children, a few other roots, and one `[[` row. The
 * seed's query nodes are left out: their results are a live subscription
 * that answers after the render, and re-run on every transaction by design,
 * which is not the row cost measured here.
 */
function graph(): WireNode[] {
  const kids = Array.from({ length: CHILDREN }, (_, i) => wire(`n.kid-${i}`, `Kid ${i}`));
  return [
    ...systemSeedNodes(ISO).filter((node) => !isQueryNode(node)),
    wire(
      "n.parent",
      "Parent",
      kids.map((k) => k.id),
    ),
    ...kids,
    wire("n.other", "Other root"),
    wire("n.typing", "[["),
  ];
}

/** The nodes whose rows rendered since the last call, in render order. */
function renderedRows(): string[] {
  const ids = vi.mocked(resolveRowChrome).mock.calls.map(([input]) => input.node.id);
  vi.mocked(resolveRowChrome).mockClear();
  return ids;
}

describe("outline update cost", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    syncUiPlugins([outlineUiPlugin]);
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
    syncUiPlugins([]);
  });

  beforeEach(async () => {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(graph(), 1, "fixtures");
    useOutlineStore.getState().expandAllInScope();
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<FrameViewSlot frameId={WORKSPACE_ROOT_ID} depth={0} />);
    });
    vi.mocked(nodeCandidates).mockClear();
    vi.mocked(resolveRowChrome).mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function rowCount(): number {
    return container.querySelectorAll('[data-node-row="true"]').length;
  }

  it("renders every row of the expanded outline", () => {
    expect(rowCount()).toBe(useOutlineStore.getState().getVisibleNodes().length);
    expect(rowCount()).toBeGreaterThan(CHILDREN);
  });

  it("re-renders only the row of the node a transaction changed", async () => {
    const changed = { ...wire("n.kid-3", "Kid three"), updatedAt: "2026-08-09T00:00:00.000Z" };
    await act(async () => {
      useOutlineStore.getState().applyTx([changed], [], { rev: 2 });
    });
    expect(container.textContent).toContain("Kid three");
    expect(new Set(renderedRows())).toEqual(new Set(["n.kid-3"]));
  });

  it("re-renders only the toggled row when a node collapses or expands", async () => {
    await act(async () => {
      useOutlineStore.getState().toggleCollapse("n.parent");
    });
    expect(rowCount()).toBe(useOutlineStore.getState().getVisibleNodes().length);
    expect(renderedRows()).toEqual(["n.parent"]);

    await act(async () => {
      useOutlineStore.getState().toggleCollapse("n.parent");
    });
    // The parent, and the children it mounts — nothing beside it.
    const rendered = renderedRows();
    expect(rendered.filter((id) => !id.startsWith("n.kid-"))).toEqual(["n.parent"]);
    expect(rendered).toHaveLength(CHILDREN + 1);
  });

  it("re-renders only the rows the selection moves between", async () => {
    const nodes = useOutlineStore.getState().nodes;
    await act(async () => {
      useOutlineStore.getState().selectNode("n.kid-1", outlineInstanceKey("n.kid-1", nodes));
    });
    expect(renderedRows()).toEqual(["n.kid-1"]);
    await act(async () => {
      useOutlineStore.getState().selectNode("n.kid-2", outlineInstanceKey("n.kid-2", nodes));
    });
    expect(new Set(renderedRows())).toEqual(new Set(["n.kid-1", "n.kid-2"]));
  });

  it("asks for no `[[` candidates while no popup is open", async () => {
    const changed = { ...wire("n.kid-3", "Kid three"), updatedAt: "2026-08-09T00:00:00.000Z" };
    await act(async () => {
      useOutlineStore.getState().applyTx([changed], [], { rev: 2 });
    });
    expect(container.textContent).toContain("Kid three");
    expect(nodeCandidates).not.toHaveBeenCalled();

    // The popup opening is what asks: the test is not blind to the call.
    const key = outlineInstanceKey("n.typing", useOutlineStore.getState().nodes);
    await act(async () => {
      useOutlineStore.getState().activateNode("n.typing", 2, key);
    });
    expect(nodeCandidates).toHaveBeenCalled();
  });
});
