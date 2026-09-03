import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { queryResultInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import type { WireNode } from "@kb/contracts";
import { BoardCardsView } from "./board-cards-view";
import { ViewToolbar } from "./view-toolbar";
import { ZoomedRootHeader } from "./zoomed-root-header";
import { listFilterFieldOptions } from "./view-filter-fields";
import {
  applyViewFilters,
  flattenBoardOrder,
  getViewConfig,
  groupChildrenForBoard,
  parseViewFilterEdn,
} from "@/lib/view-config";
import { collectVisibleInstances } from "@/lib/visible-instances";

const mockWire: WireNode[] = [
  {
    id: "frame1",
    text: "Board Frame",
    props: {
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_status" }],
      [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "board" }],
    },
    children: ["c1", "c2", "c3"],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "c1",
    text: "Alpha",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag_todo" }],
      f_status: [{ t: "str", v: "doing" }],
    },
    children: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "c2",
    text: "Beta",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag_todo" }],
      f_status: [{ t: "str", v: "done" }],
    },
    children: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "c3",
    text: "Gamma",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag_todo" }],
    },
    children: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "tag_todo",
    text: "todo",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      [SYSTEM_IDS.fieldsField]: [{ t: "ref", v: "f_status" }],
    },
    children: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "f_status",
    text: "status",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
    },
    children: [],
    createdAt: "",
    updatedAt: "",
  },
];

describe("W7.1 BoardCardsView + toolbar", () => {
  beforeEach(() => {
    useOutlineStore.getState().hydrateFromWire(mockWire, 1, "fixtures");
    useUiStore.setState({ filterPopoverFrameId: null, toasts: [] });
  });

  afterEach(() => {
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  it("ViewToolbar exposes list/table/board/cards mode buttons", () => {
    const html = renderToStaticMarkup(
      createElement(ViewToolbar, { frameId: "frame1", mode: "list" }),
    );
    expect(html).toContain('data-mode-button="list"');
    expect(html).toContain('data-mode-button="table"');
    expect(html).toContain('data-mode-button="board"');
    expect(html).toContain('data-mode-button="cards"');
    expect(html).toContain('data-filter-button="true"');
  });

  it("zoomed-header shows compact toolbar when mode ≠ list (no gear on list)", () => {
    const frame = useOutlineStore.getState().nodes.get("frame1")!;
    expect(getViewConfig(frame.props).mode).toBe("board");
    const html = renderToStaticMarkup(createElement(ZoomedRootHeader, { node: frame }));
    expect(html).toContain('data-view-toolbar="true"');
    expect(html).toContain('data-mode-button="board"');
    expect(html).not.toContain('data-view-toolbar-gear="true"');
    expect(html).toContain('data-zoomed-root-header="true"');

    const listFrame = {
      ...frame,
      props: {
        ...frame.props,
        [SYSTEM_IDS.viewModeField]: [{ t: "str" as const, v: "list" }],
      },
    };
    const listHtml = renderToStaticMarkup(createElement(ZoomedRootHeader, { node: listFrame }));
    expect(listHtml).not.toContain("data-view-toolbar");
    expect(listHtml).not.toContain("data-view-toolbar-gear");
  });

  it("board groups by view.group field with No status column", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        nodes: useOutlineStore.getState().nodes,
        widthPref: "full",
      }),
    );
    expect(html).toContain('data-view-mode="board"');
    expect(html).toContain("doing");
    expect(html).toContain("done");
    expect(html).toContain("No status");
    expect(html).toContain("Alpha");
    expect(html).toContain("Gamma");
    expect(html).toContain('data-view-card="true"');
    expect(html).toContain("node-row");
  });

  it("board with null group shows empty state + switch to cards", () => {
    const bare = mockWire.map((n) =>
      n.id === "frame1"
        ? {
            ...n,
            props: {
              [SYSTEM_IDS.viewModeField]: [{ t: "str" as const, v: "board" }],
            },
          }
        : n,
    );
    useOutlineStore.getState().hydrateFromWire(bare, 2, "fixtures");
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        nodes: useOutlineStore.getState().nodes,
      }),
    );
    expect(html).toContain('data-board-empty="true"');
    expect(html).toContain("view.group");
    expect(html).toContain('data-switch-to-cards="true"');
    expect(html).not.toContain('data-view-card="true"');
  });

  it("cards mode renders ungrouped CSS grid (no board columns)", () => {
    // Mode is read from the frame, not passed in: one source of truth.
    const asCards = mockWire.map((n) =>
      n.id === "frame1"
        ? {
            ...n,
            props: {
              ...n.props,
              [SYSTEM_IDS.viewModeField]: [{ t: "str" as const, v: "cards" }],
            },
          }
        : n,
    );
    useOutlineStore.getState().hydrateFromWire(asCards, 3, "fixtures");
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        nodes: useOutlineStore.getState().nodes,
      }),
    );
    expect(html).toContain('data-view-mode="cards"');
    expect(html).toContain('data-cards-grid="true"');
    expect(html).not.toContain("No status");
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
  });

  it("board drag unsets ALL group values then sets one; children[] untouched", async () => {
    const multi = mockWire.map((n) =>
      n.id === "c1"
        ? {
            ...n,
            props: {
              ...n.props,
              f_status: [
                { t: "str" as const, v: "doing" },
                { t: "str" as const, v: "blocked" },
              ],
            },
          }
        : n,
    );
    useOutlineStore.getState().hydrateFromWire(multi, 3, "fixtures");
    const before = [...useOutlineStore.getState().nodes.get("frame1")!.children];
    await mutations.moveBoardCard(
      "c1",
      "f_status",
      { t: "str", v: "doing" },
      { t: "str", v: "done" },
    );
    const c1 = useOutlineStore.getState().nodes.get("c1")!;
    expect(c1.props.f_status).toEqual([{ t: "str", v: "done" }]);
    expect(useOutlineStore.getState().nodes.get("frame1")!.children).toEqual(before);
  });

  it("query-source board uses ref:query instance keys", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        nodes: useOutlineStore.getState().nodes,
        rowIds: ["c1", "c2"],
        isQuerySource: true,
        widthPref: "full",
      }),
    );
    expect(html).toContain(`data-instance-key="${queryResultInstanceKey("frame1", "c1")}"`);
    expect(html).toContain(`data-instance-key="${queryResultInstanceKey("frame1", "c2")}"`);
  });

  it("setViewMode board/cards persists on frame", async () => {
    await mutations.setViewMode("frame1", "board");
    expect(useOutlineStore.getState().nodes.get("frame1")?.props[SYSTEM_IDS.viewModeField]).toEqual(
      [{ t: "str", v: "board" }],
    );
    await mutations.setViewMode("frame1", "cards");
    expect(useOutlineStore.getState().nodes.get("frame1")?.props[SYSTEM_IDS.viewModeField]).toEqual(
      [{ t: "str", v: "cards" }],
    );
  });

  it("collectVisibleInstances board column order matches flattenBoardOrder", () => {
    const nodes = useOutlineStore.getState().nodes;
    const frame = nodes.get("frame1")!;
    const kids = frame.children.map((id) => nodes.get(id)!).filter(Boolean);
    const cols = groupChildrenForBoard(kids, "f_status", nodes);
    const expected = flattenBoardOrder(cols).map((n) => n.id);
    useOutlineStore.getState().zoomTo("frame1");
    const visible = collectVisibleInstances("frame1", nodes, useOutlineStore.getState().queryDb);
    // zoomed root itself + projected cards in board order
    const projected = visible.filter((v) => v.nodeId !== "frame1").map((v) => v.nodeId);
    expect(projected).toEqual(expected);
    expect(expected[0]).toBe("c1"); // doing
    expect(expected).toContain("c3"); // empty column last
  });

  it("filter field options come from projected row tags, not global scan", () => {
    const nodes = useOutlineStore.getState().nodes;
    const opts = listFilterFieldOptions("frame1", nodes);
    expect(opts.map((o) => o.id)).toEqual(["f_status"]);
  });

  it("list/table filter smoke: text + eq filters apply", () => {
    const nodes = useOutlineStore.getState().nodes;
    const kids = ["c1", "c2", "c3"].map((id) => nodes.get(id)!);
    const textF = parseViewFilterEdn('{:text "Alph"}')!;
    const eqF = parseViewFilterEdn('{:field f_status :eq "done"}')!;
    expect(applyViewFilters(kids, [textF], nodes).map((n) => n.id)).toEqual(["c1"]);
    expect(applyViewFilters(kids, [eqF], nodes).map((n) => n.id)).toEqual(["c2"]);
    const cfg = getViewConfig({
      [SYSTEM_IDS.viewFilterField]: [{ t: "str", v: '{:field f_status :eq "doing"}' }],
    });
    expect(cfg.filters).toHaveLength(1);
    expect(applyViewFilters(kids, cfg.filters, nodes).map((n) => n.id)).toEqual(["c1"]);
  });
});

describe("Filter… host visibility", () => {
  beforeEach(() => {
    useOutlineStore.getState().hydrateFromWire(mockWire, 1, "fixtures");
    useUiStore.setState({ filterPopoverFrameId: null, toasts: [] });
  });

  it("opens portal popover when frame host exists", async () => {
    const { Window } = await import("happy-dom");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ViewFilterPopoverHost } = await import("./view-filter-popover");
    const { runPaletteCommand } = await import("@/lib/run-command");

    const win = new Window({ url: "https://kb.test/" });
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      CSS: typeof CSS;
    };
    const prev = { window: g.window, document: g.document, CSS: g.CSS };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document as unknown as Document;
    Object.assign(g, {
      CSS: { ...g.CSS, escape: (s: string) => s.replace(/"/g, '\\"') },
    });

    const host = win.document.createElement("div");
    win.document.body.appendChild(host);
    const anchor = win.document.createElement("div");
    anchor.setAttribute("data-node-block", "true");
    anchor.setAttribute("data-node-id", "frame1");
    win.document.body.appendChild(anchor);

    const root = createRoot(host as unknown as Element);
    await act(async () => {
      root.render(createElement(ViewFilterPopoverHost));
    });

    useOutlineStore.getState().zoomTo("frame1");
    await act(async () => {
      await runPaletteCommand(SYSTEM_IDS.cmdViewFilter);
    });

    expect(useUiStore.getState().filterPopoverFrameId).toBe("frame1");
    expect(win.document.querySelector('[data-view-filter-popover="true"]')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    g.window = prev.window;
    g.document = prev.document;
    g.CSS = prev.CSS;
  });

  it("toasts and clears when Filter… has no DOM host", async () => {
    const { Window } = await import("happy-dom");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ViewFilterPopoverHost } = await import("./view-filter-popover");

    const win = new Window({ url: "https://kb.test/" });
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      CSS: typeof CSS;
    };
    const prev = { window: g.window, document: g.document, CSS: g.CSS };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document as unknown as Document;
    Object.assign(g, {
      CSS: { ...g.CSS, escape: (s: string) => s.replace(/"/g, '\\"') },
    });

    const host = win.document.createElement("div");
    win.document.body.appendChild(host);
    // no frame anchor in the document
    const root = createRoot(host as unknown as Element);
    await act(async () => {
      root.render(createElement(ViewFilterPopoverHost));
    });

    await act(async () => {
      useUiStore.getState().setFilterPopoverFrameId("frame1");
    });

    expect(useUiStore.getState().filterPopoverFrameId).toBeNull();
    expect(
      useUiStore.getState().toasts.some((t) => t.text.toLowerCase().includes("select a frame")),
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
    g.window = prev.window;
    g.document = prev.document;
    g.CSS = prev.CSS;
  });
});
