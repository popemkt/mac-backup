import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultViewIdOf, present, viewOptionOf } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/api/fixture-graph";
import { framedAs, viewFieldNodes } from "@/fixtures/view-fields";
import { outlineInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS } from "@/lib/types";
import { frameConfigOf, getViewConfig } from "@/lib/view-config";
import { OutlineListView, OutlineTableView } from "@/components/outline/views";
import { paramsFrom } from "@/lib/view-key";
import { Result } from "effect";
import { fieldContextOf, schemaOf } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import type { WireNode } from "@kb/contracts";
import { TableView } from "./table-view";
import { ViewToolbar } from "./view-toolbar";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { syncUiPlugins } from "@/lib/plugins";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncUiPlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const mockWireNodes: WireNode[] = [
  ...viewFieldNodes,
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

/** The settings the table reads, decoded from frame1 the way its host decodes them. */
function tableSettings() {
  const state = useOutlineStore.getState();
  return Result.getOrThrow(
    paramsFrom(OutlineTableView, frameConfigOf(state.nodes.get("frame1"), schemaOf(state))),
  );
}

function getStoreNodes() {
  return useOutlineStore.getState().nodes;
}

describe("W7 TableView & ViewToolbar", () => {
  beforeEach(() => {
    useOutlineStore.getState().hydrateFromWire(mockWireNodes, 1, "fixtures");
    usePrefsStore.getState().setWidth("centered");
  });

  afterEach(() => {
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
    usePrefsStore.getState().setWidth("centered");
  });

  it("ViewToolbar mode switch mutation updates frame node view.mode prop", async () => {
    const html = renderToStaticMarkup(
      createElement(ViewToolbar, { frameId: "frame1", view: OutlineListView }),
    );
    expect(html).toContain('data-mode-button="table"');
    expect(html).toContain('data-mode-button="list"');

    // The frame names no view yet, so the first switch makes its view node:
    // filed in the Views list, and named first by the frame.
    await mutations.setFrameView("frame1", OutlineTableView);

    const viewId = present(defaultViewIdOf(getStoreNodes().get("frame1")), "the frame's view node");
    expect(getStoreNodes().get(SYSTEM_IDS.viewsList)?.children).toEqual([viewId]);
    expect(viewOptionOf(getStoreNodes().get(viewId))).toBe(OutlineTableView.option);
    expect(Object.keys(getStoreNodes().get("frame1")?.props ?? {})).toEqual([
      SYSTEM_IDS.viewsField,
    ]);

    // The next switch edits that node; it makes no second one.
    await mutations.setFrameView("frame1", OutlineListView);
    expect(defaultViewIdOf(getStoreNodes().get("frame1"))).toBe(viewId);
    expect(viewOptionOf(getStoreNodes().get(viewId))).toBe(OutlineListView.option);
    expect(getStoreNodes().get(SYSTEM_IDS.viewsList)?.children).toEqual([viewId]);
  });

  it("renders TableView with fallback columns from tag fields and asserts NodeRow reuse via data-instance-key", () => {
    const html = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        settings: tableSettings(),
        nodes: getStoreNodes(),
        context: fieldContextOf(useOutlineStore.getState()),
      }),
    );

    expect(html).toContain("Name");
    expect(html).toContain("status");
    expect(html).toContain("score");
    expect(html).toContain("Banana Task");
    expect(html).toContain("Apple Task");
    expect(html).toContain('data-instance-key="tree/frame1/child1"');
    expect(html).toContain('data-instance-key="tree/frame1/child2"');
    expect(html).toContain("node-row");
  });

  it("field cells render through shared FieldRow (valueOnly)", () => {
    const html = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        settings: tableSettings(),
        nodes: getStoreNodes(),
        context: fieldContextOf(useOutlineStore.getState()),
      }),
    );
    expect(html).toContain('data-field-row="true"');
    expect(html).toContain('data-field-value-only="true"');
  });

  it("a cell is the outline's value stack, remove affordance and all", () => {
    const html = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        settings: tableSettings(),
        nodes: getStoreNodes(),
        context: fieldContextOf(useOutlineStore.getState()),
      }),
    );
    // One stack per cell, keyed by the field it shows, with one slot per value.
    expect(html).toContain('data-field-values="f_status"');
    expect(html).toContain('data-field-values="f_score"');
    expect(html.match(/data-field-value="true"/g)?.length).toBe(4);
    expect(html).toContain('aria-label="Remove this value"');
  });

  it("auto-full-width breakout when width pref is centered", () => {
    const centered = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        settings: tableSettings(),
        nodes: getStoreNodes(),
        context: fieldContextOf(useOutlineStore.getState()),
        widthPref: "centered",
      }),
    );
    expect(centered).toContain("table-view-breakout");
    expect(centered).toContain('data-breakout="centered"');

    const full = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        settings: tableSettings(),
        nodes: getStoreNodes(),
        context: fieldContextOf(useOutlineStore.getState()),
        widthPref: "full",
      }),
    );
    expect(full).not.toContain("table-view-breakout");
    expect(full).not.toContain('data-breakout="centered"');
  });

  it("renders TableView columns from explicit display refs when set", async () => {
    await mutations.setViewDisplay("frame1", ["f_score"]);

    const html = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        settings: tableSettings(),
        nodes: getStoreNodes(),
        context: fieldContextOf(useOutlineStore.getState()),
      }),
    );

    expect(html).toContain("Name");
    expect(html).toContain("score");
    expect(html).not.toContain(">status<");
  });

  it("sorts table render order without mutating children[] array in store", async () => {
    const initialChildren = [
      ...present(useOutlineStore.getState().nodes.get("frame1"), "frame1").children,
    ];
    expect(initialChildren).toEqual(["child1", "child2"]);

    await mutations.setViewSort("frame1", [{ fieldId: SYSTEM_IDS.nodeTextField, dir: "asc" }]);

    const html = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        settings: tableSettings(),
        nodes: getStoreNodes(),
        context: fieldContextOf(useOutlineStore.getState()),
      }),
    );

    const posApple = html.indexOf("Apple Task");
    const posBanana = html.indexOf("Banana Task");
    expect(posApple).toBeGreaterThan(-1);
    expect(posBanana).toBeGreaterThan(-1);
    expect(posApple).toBeLessThan(posBanana);

    const storeChildren = present(
      useOutlineStore.getState().nodes.get("frame1"),
      "frame1",
    ).children;
    expect(storeChildren).toEqual(["child1", "child2"]);
  });

  it("Enter split-at-cursor inserts after the edited node (visual row) and focuses with table instanceKey", async () => {
    await mutations.setViewSort("frame1", [{ fieldId: SYSTEM_IDS.nodeTextField, dir: "asc" }]);
    // Visual first row is Apple (child2); split mid-text.
    await mutations.splitNode("child2", "Apple".length);

    const frame = present(useOutlineStore.getState().nodes.get("frame1"), "frame1");
    const appleIdx = frame.children.indexOf("child2");
    expect(appleIdx).toBeGreaterThanOrEqual(0);
    const insertedId = present(frame.children[appleIdx + 1], "inserted id");
    expect(insertedId).not.toBe("child1");

    const apple = present(useOutlineStore.getState().nodes.get("child2"), "child2");
    const created = present(useOutlineStore.getState().nodes.get(insertedId), "inserted");
    expect(apple.text).toBe("Apple");
    expect(created.text).toBe(" Task");

    // Focus lands on new node with outline/table instance key.
    const store = useOutlineStore.getState();
    expect(store.activeNodeId).toBe(insertedId);
    expect(store.activeInstanceKey).toBe(outlineInstanceKey(insertedId, store.nodes));
    expect(store.activeInstanceKey).toBe(`tree/frame1/${insertedId}`);

    // children[] still Banana then Apple then New — sort projection unchanged rule.
    expect(frame.children[0]).toBe("child1");
  });

  it("the next sort or width write drops a Name setting saved as __name__", async () => {
    const legacy = mockWireNodes.flatMap((n) =>
      n.id === "frame1"
        ? framedAs(n, "table", {
            [SYSTEM_IDS.viewSortField]: [{ t: "ref" as const, v: "__name__" }],
            [SYSTEM_IDS.viewSortDirField]: [{ t: "str" as const, v: "desc" }],
            [SYSTEM_IDS.viewColwidthField]: [
              { t: "str" as const, v: JSON.stringify({ __name__: 240 }) },
            ],
          })
        : [n],
    );
    useOutlineStore.getState().hydrateFromWire(legacy, 1, "fixtures");

    await mutations.toggleViewSort("frame1", "f_score");
    await mutations.setColumnWidth("frame1", "f_score", 120);

    // The settings are the frame's view node's.
    const props = present(useOutlineStore.getState().nodes.get("view.frame1"), "view").props;
    expect(props[SYSTEM_IDS.viewSortField]).toEqual([
      { t: "ref", v: "f_score" },
      { t: "ref", v: SYSTEM_IDS.nodeTextField },
    ]);
    expect(props[SYSTEM_IDS.viewSortDirField]).toEqual([
      { t: "str", v: "asc" },
      { t: "str", v: "desc" },
    ]);
    expect(props[SYSTEM_IDS.viewColwidthField]).toEqual([
      { t: "str", v: JSON.stringify({ [SYSTEM_IDS.nodeTextField]: 240, f_score: 120 }) },
    ]);
  });

  it("getViewConfig rejects bad colwidth shapes used by table resize path", () => {
    const bad = getViewConfig({
      [SYSTEM_IDS.viewColwidthField]: [{ t: "str", v: JSON.stringify({ a: "x", b: 0, c: 120 }) }],
    });
    expect(bad.colwidth).toEqual({});
  });
});
