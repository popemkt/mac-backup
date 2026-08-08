import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mutations } from "@/actions/mutations";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import type { WireNode } from "@kb/protocol";
import { TableView } from "./table-view";
import { ViewToolbar } from "./view-toolbar";

const mockWireNodes: WireNode[] = [
  {
    id: "frame1",
    text: "Frame Node",
    props: {},
    children: ["child1", "child2"],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "child1",
    text: "Banana Task",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag_todo" }],
      f_status: [{ t: "str", v: "done" }],
      f_score: [{ t: "num", v: 10 }],
    },
    children: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "child2",
    text: "Apple Task",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: "tag_todo" }],
      f_status: [{ t: "str", v: "in progress" }],
      f_score: [{ t: "num", v: 50 }],
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
      [SYSTEM_IDS.fieldsField]: [
        { t: "ref", v: "f_status" },
        { t: "ref", v: "f_score" },
      ],
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
  {
    id: "f_score",
    text: "score",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
    },
    children: [],
    createdAt: "",
    updatedAt: "",
  },
];

function getStoreNodes() {
  return useOutlineStore.getState().nodes;
}

import { fixtureGraph } from "@/fixtures/graph";

describe("W7 TableView & ViewToolbar", () => {
  beforeEach(() => {
    useOutlineStore.getState().hydrateFromWire(mockWireNodes, 1, "fixtures");
  });

  afterEach(() => {
    useOutlineStore
      .getState()
      .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  it("ViewToolbar mode switch mutation updates frame node view.mode prop", async () => {
    const html = renderToStaticMarkup(
      createElement(ViewToolbar, { frameId: "frame1", mode: "list" }),
    );
    expect(html).toContain('data-mode-button="table"');
    expect(html).toContain('data-mode-button="list"');

    await mutations.setViewMode("frame1", "table");
    const frame = useOutlineStore.getState().nodes.get("frame1");
    expect(frame?.props[SYSTEM_IDS.viewModeField]).toEqual([
      { t: "str", v: "table" },
    ]);

    await mutations.setViewMode("frame1", "list");
    const frameAfter = useOutlineStore.getState().nodes.get("frame1");
    expect(frameAfter?.props[SYSTEM_IDS.viewModeField]).toEqual([
      { t: "str", v: "list" },
    ]);
  });

  it("renders TableView with fallback columns from tag fields and asserts NodeRow reuse via data-instance-key", () => {
    const html = renderToStaticMarkup(
      createElement(TableView, { frameId: "frame1", nodes: getStoreNodes() }),
    );

    // Check headers
    expect(html).toContain("Name");
    expect(html).toContain("status");
    expect(html).toContain("score");

    // Check row text
    expect(html).toContain("Banana Task");
    expect(html).toContain("Apple Task");

    // Assert NodeRow reuse via data-instance-key presence in rendered HTML
    expect(html).toContain('data-instance-key="tree/frame1/child1"');
    expect(html).toContain('data-instance-key="tree/frame1/child2"');
    expect(html).toContain("node-row");
  });

  it("renders TableView columns from explicit display refs when set", async () => {
    await mutations.setViewDisplay("frame1", ["f_score"]);

    const html = renderToStaticMarkup(
      createElement(TableView, { frameId: "frame1", nodes: getStoreNodes() }),
    );

    expect(html).toContain("Name");
    expect(html).toContain("score");
    expect(html).not.toContain("status");
  });

  it("sorts table render order without mutating children[] array in store", async () => {
    // Initial store children order
    const initialChildren = [
      ...useOutlineStore.getState().nodes.get("frame1")!.children,
    ];
    expect(initialChildren).toEqual(["child1", "child2"]);

    // Apply sort by name ascending (Apple Task first)
    await mutations.setViewSort("frame1", [
      { fieldId: "__name__", dir: "asc" },
    ]);

    const html = renderToStaticMarkup(
      createElement(TableView, { frameId: "frame1", nodes: getStoreNodes() }),
    );

    // Verify rendered row order in markup (Apple Task appears before Banana Task)
    const posApple = html.indexOf("Apple Task");
    const posBanana = html.indexOf("Banana Task");
    expect(posApple).toBeGreaterThan(-1);
    expect(posBanana).toBeGreaterThan(-1);
    expect(posApple).toBeLessThan(posBanana);

    // CRITICAL INVARIANT: Children order in store must NOT be changed!
    const storeChildren = useOutlineStore.getState().nodes.get("frame1")!
      .children;
    expect(storeChildren).toEqual(["child1", "child2"]);
  });
});
