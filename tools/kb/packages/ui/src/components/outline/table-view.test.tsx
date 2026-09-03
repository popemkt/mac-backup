import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { outlineInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS } from "@/lib/types";
import { getViewConfig } from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import type { WireNode } from "@kb/contracts";
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
      createElement(ViewToolbar, { frameId: "frame1", mode: "list" }),
    );
    expect(html).toContain('data-mode-button="table"');
    expect(html).toContain('data-mode-button="list"');

    await mutations.setViewMode("frame1", "table");
    const frame = useOutlineStore.getState().nodes.get("frame1");
    expect(frame?.props[SYSTEM_IDS.viewModeField]).toEqual([{ t: "str", v: "table" }]);

    await mutations.setViewMode("frame1", "list");
    const frameAfter = useOutlineStore.getState().nodes.get("frame1");
    expect(frameAfter?.props[SYSTEM_IDS.viewModeField]).toEqual([{ t: "str", v: "list" }]);
  });

  it("renders TableView with fallback columns from tag fields and asserts NodeRow reuse via data-instance-key", () => {
    const html = renderToStaticMarkup(
      createElement(TableView, { frameId: "frame1", nodes: getStoreNodes() }),
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
      createElement(TableView, { frameId: "frame1", nodes: getStoreNodes() }),
    );
    expect(html).toContain('data-field-row="true"');
    expect(html).toContain('data-field-value-only="true"');
  });

  it("auto-full-width breakout when width pref is centered", () => {
    const centered = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        nodes: getStoreNodes(),
        widthPref: "centered",
      }),
    );
    expect(centered).toContain("table-view-breakout");
    expect(centered).toContain('data-breakout="centered"');

    const full = renderToStaticMarkup(
      createElement(TableView, {
        frameId: "frame1",
        nodes: getStoreNodes(),
        widthPref: "full",
      }),
    );
    expect(full).not.toContain("table-view-breakout");
    expect(full).not.toContain('data-breakout="centered"');
  });

  it("renders TableView columns from explicit display refs when set", async () => {
    await mutations.setViewDisplay("frame1", ["f_score"]);

    const html = renderToStaticMarkup(
      createElement(TableView, { frameId: "frame1", nodes: getStoreNodes() }),
    );

    expect(html).toContain("Name");
    expect(html).toContain("score");
    expect(html).not.toContain(">status<");
  });

  it("sorts table render order without mutating children[] array in store", async () => {
    const initialChildren = [...useOutlineStore.getState().nodes.get("frame1")!.children];
    expect(initialChildren).toEqual(["child1", "child2"]);

    await mutations.setViewSort("frame1", [{ fieldId: "__name__", dir: "asc" }]);

    const html = renderToStaticMarkup(
      createElement(TableView, { frameId: "frame1", nodes: getStoreNodes() }),
    );

    const posApple = html.indexOf("Apple Task");
    const posBanana = html.indexOf("Banana Task");
    expect(posApple).toBeGreaterThan(-1);
    expect(posBanana).toBeGreaterThan(-1);
    expect(posApple).toBeLessThan(posBanana);

    const storeChildren = useOutlineStore.getState().nodes.get("frame1")!.children;
    expect(storeChildren).toEqual(["child1", "child2"]);
  });

  it("Enter split-at-cursor inserts after the edited node (visual row) and focuses with table instanceKey", async () => {
    await mutations.setViewSort("frame1", [{ fieldId: "__name__", dir: "asc" }]);
    // Visual first row is Apple (child2); split mid-text.
    await mutations.splitNode("child2", "Apple".length);

    const frame = useOutlineStore.getState().nodes.get("frame1")!;
    const appleIdx = frame.children.indexOf("child2");
    expect(appleIdx).toBeGreaterThanOrEqual(0);
    const insertedId = frame.children[appleIdx + 1];
    expect(insertedId).toBeTruthy();
    expect(insertedId).not.toBe("child1");

    const apple = useOutlineStore.getState().nodes.get("child2")!;
    const created = useOutlineStore.getState().nodes.get(insertedId!)!;
    expect(apple.text).toBe("Apple");
    expect(created.text).toBe(" Task");

    // Focus lands on new node with outline/table instance key.
    const store = useOutlineStore.getState();
    expect(store.activeNodeId).toBe(insertedId);
    expect(store.activeInstanceKey).toBe(outlineInstanceKey(insertedId!, store.nodes));
    expect(store.activeInstanceKey).toBe(`tree/frame1/${insertedId}`);

    // children[] still Banana then Apple then New — sort projection unchanged rule.
    expect(frame.children[0]).toBe("child1");
  });

  it("getViewConfig rejects bad colwidth shapes used by table resize path", () => {
    const bad = getViewConfig({
      [SYSTEM_IDS.viewColwidthField]: [{ t: "str", v: JSON.stringify({ a: "x", b: 0, c: 120 }) }],
    });
    expect(bad.colwidth).toEqual({ c: 120 });
  });
});
