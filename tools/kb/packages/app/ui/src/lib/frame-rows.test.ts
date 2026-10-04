/**
 * frame-rows is the single owner of frame row order and pagination. These
 * tests pin the contract every renderer and the nav walk share.
 */
import {
  familyViews,
  schemaOf,
  SYSTEM_IDS,
  ViewPoint,
  type NodeMap,
  type OutlineNode,
  type SchemaIndex,
} from "@kb/ui-sdk";
import { Effect, Schema } from "effect";
import { makeKernel } from "@kb/plugin";
import { describe, expect, it } from "vitest";
import { frameRows, type FrameRowsInput } from "@/lib/frame-rows";
import { frameViewOf } from "@/lib/view-config";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { isFrameViewKey, OutlineTableView } from "@kb/views";
import { framedAs, viewOptionNodes, type FrameViewName } from "@/fixtures/view-fields";

/** The one constructor, over an unscoped graph: the whole map is the schema. */
function schemaFor(nodes: NodeMap): SchemaIndex {
  return schemaOf({ ontologyId: null, nodes, wireNodes: [] });
}

/** The frame views the outline plugin provides, as its hosts see them. */
const VIEWS = (() => {
  const kernel = makeKernel();
  Effect.runSync(kernel.load(outlineUiPlugin));
  return familyViews(kernel.contributions(ViewPoint), isFrameViewKey).map(({ key }) => key);
})();

/** A frame's rows input, in the view its props name, as every host resolves it. */
function input(nodes: NodeMap, frameId = "frame"): FrameRowsInput {
  const view = frameViewOf(nodes.get(frameId), schemaFor(nodes), VIEWS);
  if (view === null) throw new Error("the outline plugin provides no list view");
  return { frameId, nodes, schema: schemaFor(nodes), view };
}

function rowsOf(nodes: NodeMap, frameId = "frame") {
  return frameRows(input(nodes, frameId));
}

/** Every setting a frame view reads, at its default: what each view's params keep a part of. */
const SETTINGS = {
  filters: [],
  sort: [],
  display: [],
  colwidth: {},
  pagesize: 100,
  groupFieldId: null,
};

function node(
  id: string,
  text: string,
  props: OutlineNode["props"] = {},
  children: string[] = [],
): OutlineNode {
  return {
    id,
    text,
    parentId: null,
    children,
    collapsed: false,
    props,
    createdAt: "",
    updatedAt: "",
    tags: [],
  };
}

/** A frame of `rowCount` rows shown as `view`, whose view node carries `settings`. */
function graph(view: FrameViewName, settings: OutlineNode["props"], rowCount = 5): NodeMap {
  const map: NodeMap = new Map();
  const ids: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const id = `r${i}`;
    ids.push(id);
    map.set(id, node(id, `row ${i}`, { f_status: [{ t: "str", v: `s${i % 2}` }] }));
  }
  const [frame, viewNode] = framedAs(node("frame", "Frame", {}, ids), view, settings);
  map.set(frame.id, frame);
  map.set(viewNode.id, node(viewNode.id, "", viewNode.props));
  for (const option of viewOptionNodes)
    map.set(option.id, node(option.id, option.text, option.props, option.children));
  return map;
}

const pagesize = (size: number): OutlineNode["props"] => ({
  [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: size }],
});

describe("which views paginate", () => {
  it("is the views whose params declare a page size: the table, today", () => {
    const paginating = VIEWS.filter((view) =>
      Object.hasOwn(Schema.decodeUnknownSync(view.params)(SETTINGS), "pagesize"),
    );
    expect(paginating).toEqual([OutlineTableView]);
  });
});

describe("frameRows pagination", () => {
  it("renders the first page and reports the rest as more", () => {
    const nodes = graph("table", pagesize(2));
    const rows = frameRows(input(nodes));
    expect(rows.ordered).toHaveLength(5);
    expect(rows.rendered.map((n) => n.id)).toEqual(["r0", "r1"]);
    expect(rows.hasMore).toBe(true);
  });

  it("reveals one further page per revealed page", () => {
    const nodes = graph("table", pagesize(2));
    expect(frameRows({ ...input(nodes), pages: 2 }).rendered.map((n) => n.id)).toEqual([
      "r0",
      "r1",
      "r2",
      "r3",
    ]);
    const all = frameRows({ ...input(nodes), pages: 3 });
    expect(all.rendered).toHaveLength(5);
    expect(all.hasMore).toBe(false);
  });

  it("tracks pages, not an absolute count, so pagesize changes re-derive", () => {
    // Same revealed page count against a larger pagesize shows more rows —
    // an absolute reveal count would have stayed stale at the old limit.
    const small = rowsOf(graph("table", pagesize(2)));
    const large = rowsOf(graph("table", pagesize(4)));
    expect(small.rendered).toHaveLength(2);
    expect(large.rendered).toHaveLength(4);
  });

  it("does not paginate non-paginating modes", () => {
    const nodes = graph("cards", {
      [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 2 }],
    });
    const rows = frameRows(input(nodes));
    expect(rows.rendered).toHaveLength(5);
    expect(rows.hasMore).toBe(false);
  });
});

describe("frameRows grouping", () => {
  it("board order is its columns flattened, and names the group field", () => {
    const nodes = graph("board", {
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_status" }],
    });
    const rows = frameRows(input(nodes));
    expect(rows.groupFieldId).toBe("f_status");
    expect(rows.columns.length).toBeGreaterThan(1);
    expect(rows.ordered.map((n) => n.id)).toEqual(
      rows.columns.flatMap((c) => c.nodes.map((n) => n.id)),
    );
  });

  it("cards is a single ungrouped column", () => {
    const nodes = graph("cards", {
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_status" }],
    });
    const rows = frameRows(input(nodes));
    expect(rows.groupFieldId).toBeNull();
    expect(rows.columns).toHaveLength(1);
    expect(rows.ordered).toHaveLength(5);
  });
});

describe("frameRows sources", () => {
  it("explicit rowIds override the frame's own children", () => {
    const nodes = graph("table", pagesize(10));
    const rows = frameRows({
      ...input(nodes),
      rowIds: ["r3", "r1"],
    });
    expect(rows.rendered.map((n) => n.id)).toEqual(["r3", "r1"]);
  });

  it("drops row ids that are not in the graph", () => {
    const nodes = graph("table", pagesize(10));
    const rows = frameRows({
      ...input(nodes),
      rowIds: ["r0", "ghost"],
    });
    expect(rows.rendered.map((n) => n.id)).toEqual(["r0"]);
  });

  it("returns nothing for an unknown frame", () => {
    const rows = rowsOf(new Map(), "missing");
    expect(rows.ordered).toEqual([]);
    expect(rows.rendered).toEqual([]);
  });
});

describe("frameRows in the list view", () => {
  it("applies the frame's view filters", () => {
    const nodes = graph("list", {
      [SYSTEM_IDS.viewFilterField]: [{ t: "str", v: `{:field f_status :eq "s0"}` }],
    });
    expect(rowsOf(nodes).rendered.map((n) => n.id)).toEqual(["r0", "r2", "r4"]);
  });

  it("keeps the children's order: the list declares no sort", () => {
    const nodes = graph("list", {
      [SYSTEM_IDS.viewSortField]: [{ t: "ref", v: SYSTEM_IDS.nodeTextField }],
      [SYSTEM_IDS.viewSortDirField]: [{ t: "str", v: "desc" }],
    });
    expect(rowsOf(nodes).rendered.map((n) => n.id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
  });

  it("is empty for an unknown frame", () => {
    expect(rowsOf(new Map(), "missing").rendered).toEqual([]);
  });
});
