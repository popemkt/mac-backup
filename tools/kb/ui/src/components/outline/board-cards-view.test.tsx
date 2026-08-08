import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { queryResultInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import type { WireNode } from "@kb/protocol";
import { BoardCardsView } from "./board-cards-view";
import { ViewToolbar } from "./view-toolbar";

const mockWire: WireNode[] = [
  {
    id: "frame1",
    text: "Board Frame",
    props: {
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_status" }],
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
  });

  afterEach(() => {
    useOutlineStore
      .getState()
      .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
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

  it("board groups by view.group field with No status column", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        mode: "board",
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

  it("cards mode renders ungrouped CSS grid (no board columns)", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        mode: "cards",
        nodes: useOutlineStore.getState().nodes,
      }),
    );
    expect(html).toContain('data-view-mode="cards"');
    expect(html).toContain('data-cards-grid="true"');
    expect(html).not.toContain("No status");
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
  });

  it("board drag mutation unsets old group value and sets new; children[] untouched", async () => {
    const before = [
      ...useOutlineStore.getState().nodes.get("frame1")!.children,
    ];
    await mutations.moveBoardCard(
      "c1",
      "f_status",
      { t: "str", v: "doing" },
      { t: "str", v: "done" },
    );
    const c1 = useOutlineStore.getState().nodes.get("c1")!;
    expect(c1.props.f_status).toEqual([{ t: "str", v: "done" }]);
    expect(useOutlineStore.getState().nodes.get("frame1")!.children).toEqual(
      before,
    );
  });

  it("query-source board uses ref:query instance keys", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCardsView, {
        frameId: "frame1",
        mode: "board",
        nodes: useOutlineStore.getState().nodes,
        rowIds: ["c1", "c2"],
        isQuerySource: true,
        widthPref: "full",
      }),
    );
    expect(html).toContain(
      `data-instance-key="${queryResultInstanceKey("frame1", "c1")}"`,
    );
    expect(html).toContain(
      `data-instance-key="${queryResultInstanceKey("frame1", "c2")}"`,
    );
  });

  it("setViewMode board/cards persists on frame", async () => {
    await mutations.setViewMode("frame1", "board");
    expect(
      useOutlineStore.getState().nodes.get("frame1")?.props[
        SYSTEM_IDS.viewModeField
      ],
    ).toEqual([{ t: "str", v: "board" }]);
    await mutations.setViewMode("frame1", "cards");
    expect(
      useOutlineStore.getState().nodes.get("frame1")?.props[
        SYSTEM_IDS.viewModeField
      ],
    ).toEqual([{ t: "str", v: "cards" }]);
  });
});
