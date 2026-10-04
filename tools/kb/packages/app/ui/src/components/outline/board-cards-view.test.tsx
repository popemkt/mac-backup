import {
  fieldContextOf,
  queryResultInstanceKey,
  schemaOf,
  syncUiPlugins,
  SYSTEM_IDS,
  type NodeMap,
  type SchemaIndex,
} from "@kb/ui-sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultViewIdOf, present, viewOptionOf } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/api/fixture-graph";
import { framedAs, viewFieldNodes, type FrameViewName } from "@/fixtures/view-fields";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import type { WireNode } from "@kb/contracts";
import { BoardCardsView } from "./board-cards-view";
import { ViewToolbar } from "./view-toolbar";
import { ZoomedRootHeader } from "./zoomed-root-header";
import { listFilterFieldOptions } from "./view-filter-fields";
import {
  applyViewFilters,
  flattenBoardOrder,
  frameViewOf,
  getViewConfig,
  groupChildrenForBoard,
} from "@/lib/view-config";
import {
  parseViewFilterEdn,
  OutlineBoardView,
  OutlineCardsView,
  OutlineListView,
  paramsFrom,
} from "@kb/views";
import { Result } from "effect";
import { collectVisibleInstances } from "@/lib/visible-instances";
import { providedFrameViews } from "@/stores/frame-views";
import { outlineUiPlugin } from "@/components/outline/plugin";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncUiPlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

/** The frame views provided, as the outline's hosts resolve against them. */
function frameViewKeys() {
  return providedFrameViews().map(({ key }) => key);
}

/** frame1's view as its host resolves it (`frameViewOf`): board or cards, with the settings it reads. */
function columnsView() {
  const { nodes } = useOutlineStore.getState();
  const view = frameViewOf(
    nodes.get("frame1"),
    schemaOf(useOutlineStore.getState()),
    frameViewKeys(),
  );
  if (view === null) throw new Error("no frame view is provided");
  const { key, params } = view;
  if (key === OutlineCardsView)
    return {
      key: OutlineCardsView,
      params: Result.getOrThrow(paramsFrom(OutlineCardsView, params)),
    };
  if (key === OutlineBoardView)
    return {
      key: OutlineBoardView,
      params: Result.getOrThrow(paramsFrom(OutlineBoardView, params)),
    };
  throw new Error(`frame1 is shown in ${key.id}, not in columns`);
}

/** The view frame1's default view node names now. */
function viewOf(): string | null {
  const { nodes } = useOutlineStore.getState();
  return viewOptionOf(nodes.get(defaultViewIdOf(nodes.get("frame1")) ?? ""));
}

/** The one constructor, over an unscoped graph: the whole map is the schema. */
function schemaFor(nodes: NodeMap): SchemaIndex {
  return schemaOf({ ontologyId: null, nodes, wireNodes: [] });
}

const FRAME1: WireNode = {
  id: "frame1",
  text: "Board Frame",
  props: {},
  children: ["c1", "c2", "c3"],
  createdAt: "",
  updatedAt: "",
};
const GROUPED = { [SYSTEM_IDS.viewGroupField]: [{ t: "ref" as const, v: "f_status" }] };

/** The mock graph with frame1 shown as `view`, its view node carrying `settings`. */
function withFrame1(view: FrameViewName, settings: WireNode["props"]): WireNode[] {
  const shown = framedAs(FRAME1, view, settings);
  return mockWire
    .filter((n) => n.id !== shown[1].id)
    .flatMap((n) => (n.id === FRAME1.id ? shown : [n]));
}

const mockWire: WireNode[] = [
  ...viewFieldNodes,
  ...framedAs(FRAME1, "board", GROUPED),
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
      createElement(ViewToolbar, { frameId: "frame1", view: OutlineListView }),
    );
    expect(html).toContain('data-mode-button="list"');
    expect(html).toContain('data-mode-button="table"');
    expect(html).toContain('data-mode-button="board"');
    expect(html).toContain('data-mode-button="cards"');
    expect(html).toContain('data-filter-button="true"');
  });

  it("zoomed-header shows the toolbar when mode ≠ list, and a quiet gear on list", () => {
    const { nodes } = useOutlineStore.getState();
    const frame = present(nodes.get("frame1"), "frame1");
    expect(frameViewOf(frame, schemaFor(nodes), frameViewKeys())?.key).toBe(OutlineBoardView);
    const html = renderToStaticMarkup(
      createElement(ZoomedRootHeader, { node: frame, view: OutlineBoardView }),
    );
    expect(html).toContain('data-view-toolbar="true"');
    expect(html).toContain('data-mode-button="board"');
    expect(html).not.toContain('data-view-toolbar-gear="true"');
    expect(html).toContain('data-zoomed-root-header="true"');

    // A frame that names no view node is shown as a list.
    const listFrame = { ...frame, props: {} };
    const listHtml = renderToStaticMarkup(
      createElement(ZoomedRootHeader, { node: listFrame, view: OutlineListView }),
    );
    // P2-6: a list frame still reaches table/board/cards, through one gear
    // that stays invisible until the header is hovered or focused.
    expect(listHtml).not.toContain('data-view-toolbar="true"');
    expect(listHtml).toContain('data-view-toolbar-gear="true"');
    expect(listHtml).toMatch(/data-view-control="true"/);
    expect(listHtml).toMatch(/opacity-0[^"]*group-hover\/header:opacity-100/);
  });

  it("board groups by view.group field with No status column", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        view: columnsView(),
        nodes: useOutlineStore.getState().nodes,
        context: fieldContextOf(useOutlineStore.getState()),
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
    useOutlineStore.getState().hydrateFromWire(withFrame1("board", {}), 2, "fixtures");
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        view: columnsView(),
        nodes: useOutlineStore.getState().nodes,
        context: fieldContextOf(useOutlineStore.getState()),
      }),
    );
    expect(html).toContain('data-board-empty="true"');
    expect(html).toContain("view.group");
    expect(html).toContain('data-switch-to-cards="true"');
    expect(html).not.toContain('data-view-card="true"');
  });

  it("cards mode renders ungrouped CSS grid (no board columns)", () => {
    // The view is the frame's own, resolved the way its host resolves it.
    useOutlineStore.getState().hydrateFromWire(withFrame1("cards", GROUPED), 3, "fixtures");
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        view: columnsView(),
        nodes: useOutlineStore.getState().nodes,
        context: fieldContextOf(useOutlineStore.getState()),
      }),
    );
    expect(html).toContain('data-view-mode="cards"');
    expect(html).toContain('data-cards-grid="true"');
    expect(html).not.toContain("No status");
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    // A card's fields are the outline's value stack: one per field, one slot
    // per value, and the one empty slot for a card that holds none.
    expect(html.match(/data-field-values="f_status"/g)?.length).toBe(3);
    expect(html.match(/data-field-value="true"/g)?.length).toBe(2);
    expect(html).toContain('aria-label="Remove this value"');
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
    const before = [...present(useOutlineStore.getState().nodes.get("frame1"), "frame1").children];
    await mutations.moveBoardCard(
      "c1",
      "f_status",
      { t: "str", v: "doing" },
      { t: "str", v: "done" },
    );
    const after = useOutlineStore.getState().nodes;
    const c1 = present(after.get("c1"), "c1");
    expect(c1.props.f_status).toEqual([{ t: "str", v: "done" }]);
    expect(present(after.get("frame1"), "frame1").children).toEqual(before);
  });

  it("query-source board uses ref:query instance keys", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        view: columnsView(),
        nodes: useOutlineStore.getState().nodes,
        context: fieldContextOf(useOutlineStore.getState()),
        rowIds: ["c1", "c2"],
        isQuerySource: true,
        widthPref: "full",
      }),
    );
    expect(html).toContain(`data-instance-key="${queryResultInstanceKey("frame1", "c1")}"`);
    expect(html).toContain(`data-instance-key="${queryResultInstanceKey("frame1", "c2")}"`);
  });

  it("setFrameView board/cards persists on the frame's view node", async () => {
    await mutations.setFrameView("frame1", OutlineCardsView);
    expect(viewOf()).toBe(OutlineCardsView.option);
    await mutations.setFrameView("frame1", OutlineBoardView);
    expect(viewOf()).toBe(OutlineBoardView.option);
    // The group setting the view node held is kept across the switch.
    expect(columnsView().params).toMatchObject({ groupFieldId: "f_status" });
  });

  it("collectVisibleInstances board column order matches flattenBoardOrder", () => {
    const nodes = useOutlineStore.getState().nodes;
    const frame = present(nodes.get("frame1"), "frame1");
    const kids = frame.children.map((id) => present(nodes.get(id), id));
    const cols = groupChildrenForBoard(kids, "f_status", schemaFor(nodes));
    const expected = flattenBoardOrder(cols).map((n) => n.id);
    useOutlineStore.getState().zoomTo("frame1");
    const visible = collectVisibleInstances("frame1", {
      nodes,
      schema: schemaFor(nodes),
      queryDb: useOutlineStore.getState().index,
      views: frameViewKeys(),
      chain: [],
      pages: {},
    });
    // zoomed root itself + projected cards in board order
    const projected = visible.filter((v) => v.nodeId !== "frame1").map((v) => v.nodeId);
    expect(projected).toEqual(expected);
    expect(expected[0]).toBe("c1"); // doing
    expect(expected).toContain("c3"); // empty column last
  });

  it("filter field options come from projected row tags, not global scan", () => {
    const nodes = useOutlineStore.getState().nodes;
    const opts = listFilterFieldOptions("frame1", nodes, schemaFor(nodes));
    expect(opts.map((o) => o.id)).toEqual(["f_status"]);
  });

  it("list/table filter smoke: text + eq filters apply", () => {
    const nodes = useOutlineStore.getState().nodes;
    const kids = ["c1", "c2", "c3"].map((id) => present(nodes.get(id), id));
    const textF = present(parseViewFilterEdn('{:text "Alph"}'), "text filter");
    const eqF = present(parseViewFilterEdn('{:field f_status :eq "done"}'), "eq filter");
    expect(applyViewFilters(kids, [textF], schemaFor(nodes)).map((n) => n.id)).toEqual(["c1"]);
    expect(applyViewFilters(kids, [eqF], schemaFor(nodes)).map((n) => n.id)).toEqual(["c2"]);
    const cfg = getViewConfig({
      [SYSTEM_IDS.viewFilterField]: [{ t: "str", v: '{:field f_status :eq "doing"}' }],
    });
    expect(cfg.filters).toHaveLength(1);
    expect(applyViewFilters(kids, cfg.filters, schemaFor(nodes)).map((n) => n.id)).toEqual(["c1"]);
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
    const { runCommand, commandTargetNodeId, viewTargetFrameId } = await import("@/lib/commands");

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
      const outline = useOutlineStore.getState();
      await runCommand(SYSTEM_IDS.cmdViewFilter, {
        target: { nodeId: commandTargetNodeId(outline), frameId: viewTargetFrameId(outline) },
        outline,
        prefs: usePrefsStore.getState(),
        ui: useUiStore.getState(),
        debugFields: useDebugFieldsStore.getState(),
        workspace: useWorkspaceStore.getState(),
        palette: { close: () => {}, openStep: () => {} },
      });
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
