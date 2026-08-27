/**
 * frame-rows is the single owner of frame row order and pagination. These
 * tests pin the contract every renderer and the nav walk share.
 */
import { describe, expect, it } from "vitest";
import { frameListChildren, frameRows, modePaginates } from "@/lib/frame-rows";
import { SYSTEM_IDS, type NodeMap, type OutlineNode } from "@/lib/types";

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

function graph(frameProps: OutlineNode["props"], rowCount = 5): NodeMap {
  const map: NodeMap = new Map();
  const ids: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const id = `r${i}`;
    ids.push(id);
    map.set(id, node(id, `row ${i}`, { f_status: [{ t: "str", v: `s${i % 2}` }] }));
  }
  map.set("frame", node("frame", "Frame", frameProps, ids));
  return map;
}

const asTable = (pagesize?: number): OutlineNode["props"] => ({
  [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "table" }],
  ...(pagesize === undefined
    ? {}
    : { [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: pagesize }] }),
});

describe("modePaginates", () => {
  it("is true only for table today", () => {
    expect(modePaginates("table")).toBe(true);
    expect(modePaginates("list")).toBe(false);
    expect(modePaginates("board")).toBe(false);
    expect(modePaginates("cards")).toBe(false);
  });
});

describe("frameRows pagination", () => {
  it("renders the first page and reports the rest as more", () => {
    const nodes = graph(asTable(2));
    const rows = frameRows({ frameId: "frame", nodes });
    expect(rows.ordered).toHaveLength(5);
    expect(rows.rendered.map((n) => n.id)).toEqual(["r0", "r1"]);
    expect(rows.hasMore).toBe(true);
  });

  it("reveals one further page per revealed page", () => {
    const nodes = graph(asTable(2));
    expect(
      frameRows({ frameId: "frame", nodes, pages: 2 }).rendered.map((n) => n.id),
    ).toEqual(["r0", "r1", "r2", "r3"]);
    const all = frameRows({ frameId: "frame", nodes, pages: 3 });
    expect(all.rendered).toHaveLength(5);
    expect(all.hasMore).toBe(false);
  });

  it("tracks pages, not an absolute count, so pagesize changes re-derive", () => {
    // Same revealed page count against a larger pagesize shows more rows —
    // an absolute reveal count would have stayed stale at the old limit.
    const small = frameRows({ frameId: "frame", nodes: graph(asTable(2)) });
    const large = frameRows({ frameId: "frame", nodes: graph(asTable(4)) });
    expect(small.rendered).toHaveLength(2);
    expect(large.rendered).toHaveLength(4);
  });

  it("does not paginate non-paginating modes", () => {
    const nodes = graph({
      [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "cards" }],
      [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 2 }],
    });
    const rows = frameRows({ frameId: "frame", nodes });
    expect(rows.rendered).toHaveLength(5);
    expect(rows.hasMore).toBe(false);
  });
});

describe("frameRows grouping", () => {
  it("board order is its columns flattened, and names the group field", () => {
    const nodes = graph({
      [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "board" }],
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_status" }],
    });
    const rows = frameRows({ frameId: "frame", nodes });
    expect(rows.groupFieldId).toBe("f_status");
    expect(rows.columns.length).toBeGreaterThan(1);
    expect(rows.ordered.map((n) => n.id)).toEqual(
      rows.columns.flatMap((c) => c.nodes.map((n) => n.id)),
    );
  });

  it("cards is a single ungrouped column", () => {
    const nodes = graph({
      [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "cards" }],
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_status" }],
    });
    const rows = frameRows({ frameId: "frame", nodes });
    expect(rows.groupFieldId).toBeNull();
    expect(rows.columns).toHaveLength(1);
    expect(rows.ordered).toHaveLength(5);
  });
});

describe("frameRows sources", () => {
  it("explicit rowIds override the frame's own children", () => {
    const nodes = graph(asTable(10));
    const rows = frameRows({ frameId: "frame", nodes, rowIds: ["r3", "r1"] });
    expect(rows.rendered.map((n) => n.id)).toEqual(["r3", "r1"]);
  });

  it("drops row ids that are not in the graph", () => {
    const nodes = graph(asTable(10));
    const rows = frameRows({ frameId: "frame", nodes, rowIds: ["r0", "ghost"] });
    expect(rows.rendered.map((n) => n.id)).toEqual(["r0"]);
  });

  it("returns nothing for an unknown frame", () => {
    const rows = frameRows({ frameId: "missing", nodes: new Map() });
    expect(rows.ordered).toEqual([]);
    expect(rows.rendered).toEqual([]);
  });
});

describe("frameListChildren", () => {
  it("applies the frame's view filters", () => {
    const nodes = graph({
      [SYSTEM_IDS.viewFilterField]: [
        { t: "str", v: `{:field f_status :eq "s0"}` },
      ],
    });
    const kids = frameListChildren("frame", nodes);
    expect(kids.map((n) => n.id)).toEqual(["r0", "r2", "r4"]);
  });

  it("is empty for an unknown frame", () => {
    expect(frameListChildren("missing", new Map())).toEqual([]);
  });
});
