/**
 * Groups and frames, one concept: membership is the `parent` an item names,
 * honoured only when it names a group and makes no cycle; a group carries
 * its members through every transform, an edit of its box, a delete and a
 * copy; geometry proposes membership only when an item is placed or let go.
 */
import { describe, expect, test } from "bun:test";
import {
  canvasMembership,
  carriedBy,
  carriedPart,
  editItem,
  groupItems,
  motionOf,
  moveBy,
  paintOrder,
  parseCanvasDoc,
  pasteItems,
  selectionPivot,
  settleMembership,
  stillAbout,
  stringifyCanvasDoc,
  transformCarried,
  turnAbout,
  ungroupItems,
  viewpointFrames,
  withMembers,
  withParent,
  type CanvasDoc,
  type CanvasNode,
} from "../src/index.ts";

const frame = (id: string, [x = 0, y = 0, w = 0, h = 0]: readonly number[], parent?: string) =>
  ({
    id,
    type: "group",
    label: id,
    x,
    y,
    width: w,
    height: h,
    ...(parent === undefined ? {} : { parent }),
  }) satisfies CanvasNode;
const sticky = (id: string, x: number, y: number, parent?: string) =>
  ({
    id,
    type: "text",
    text: id,
    x,
    y,
    width: 40,
    height: 20,
    ...(parent === undefined ? {} : { parent }),
  }) satisfies CanvasNode;

/** An outer frame holding a sticky and an inner frame, which holds a sticky of its own. */
const nested: CanvasDoc = {
  nodes: [
    sticky("a", 20, 20, "outer"),
    frame("outer", [0, 0, 400, 300]),
    frame("inner", [200, 100, 160, 160], "outer"),
    sticky("b", 240, 140, "inner"),
    sticky("loose", 600, 0),
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "inner" }],
};
const ids = (nodes: readonly { id: string }[]) => nodes.map((n) => n.id);
const byId = (doc: CanvasDoc, id: string) => doc.nodes.find((n) => n.id === id);

describe("the parent field", () => {
  test("round-trips, and a value kb cannot read stays an unknown field until kb writes one", () => {
    const doc = parseCanvasDoc(stringifyCanvasDoc(nested));
    expect(byId(doc, "b")?.parent).toBe("inner");
    const odd = parseCanvasDoc({ nodes: [{ ...sticky("x", 0, 0), parent: 7 }], edges: [] });
    const [x] = odd.nodes;
    expect(x?.parent).toBeUndefined();
    expect(x?.extra).toEqual({ parent: 7 });
    expect(JSON.parse(stringifyCanvasDoc(odd)).nodes[0].parent).toBe(7);
    if (x === undefined) return;
    const set = withParent(x, "outer");
    expect(set.parent).toBe("outer");
    expect(set.extra).toBeUndefined();
    expect(withParent(set, undefined)).not.toHaveProperty("parent");
  });
});

describe("membership", () => {
  test("is the parent an item names, nested to any depth", () => {
    const m = canvasMembership(nested.nodes);
    expect(m.parentOf("b")).toBe("inner");
    expect(m.parentOf("inner")).toBe("outer");
    expect(m.parentOf("loose")).toBeNull();
    expect(m.membersOf("outer")).toEqual(["a", "inner"]);
    expect(m.membersOf(null)).toEqual(["outer", "loose"]);
  });

  test("is not honoured for a parent that is missing, not a group, or on a cycle", () => {
    const m = canvasMembership([
      sticky("s", 0, 0, "nowhere"),
      sticky("t", 0, 0, "s"),
      frame("p", [0, 0, 100, 100], "q"),
      frame("q", [0, 0, 100, 100], "p"),
      sticky("u", 0, 0, "p"),
    ]);
    expect(["s", "t", "p", "q"].map(m.parentOf)).toEqual([null, null, null, null]);
    // A member of a group on a cycle still belongs to that group.
    expect(m.parentOf("u")).toBe("p");
  });

  test("paints a group under its members at one height, whatever the document order", () => {
    expect(ids(paintOrder(nested.nodes))).toEqual(["outer", "a", "inner", "b", "loose"]);
    // Height still comes first: a raised member's group does not climb over it, nor it under.
    const raisedFrame = nested.nodes.map((n) => (n.id === "inner" ? { ...n, z: 50 } : n));
    expect(ids(paintOrder(raisedFrame))).toEqual(["outer", "a", "b", "loose", "inner"]);
  });

  test("names the frames a canvas is seen through: its groups that belong to no other", () => {
    expect(ids(viewpointFrames(nested.nodes))).toEqual(["outer"]);
  });
});

describe("what an act carries", () => {
  test("the items named, less those another named one holds, and every member below", () => {
    const carried = carriedBy(nested.nodes, ["outer", "b", "loose", "ghost"]);
    expect(ids(carried.items)).toEqual(["outer", "loose"]);
    expect(ids(carried.members).toSorted()).toEqual(["a", "b", "inner"]);
    expect([...withMembers(nested.nodes, ["inner"])].toSorted()).toEqual(["b", "inner"]);
  });

  test("a group's transform moves and turns its members with it", () => {
    const carried = carriedBy(nested.nodes, ["outer"]);
    const moved = transformCarried(
      nested,
      carried,
      moveBy({ x: 0, y: 0, z: 0 }, { x: 10, y: 5, z: 0 }),
    );
    expect(["outer", "a", "inner", "b", "loose"].map((id) => byId(moved, id)?.x)).toEqual([
      10, 30, 210, 250, 600,
    ]);
    const quarter = turnAbout({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    const pivot = selectionPivot(carried.items);
    const turned = transformCarried(nested, carried, { ...stillAbout(pivot), turn: quarter });
    expect(byId(turned, "b")?.rotation).toEqual({ z: 90 });
    // b's centre (260, 150) swings a quarter round the frame's centre (200, 150).
    const b = byId(turned, "b");
    expect((b?.x ?? 0) + 20).toBeCloseTo(200, 6);
    expect((b?.y ?? 0) + 10).toBeCloseTo(210, 6);
  });

  test("an extrude grows the items it names, and no member", () => {
    const grown = transformCarried(nested, carriedBy(nested.nodes, ["inner"]), {
      ...stillAbout({ x: 0, y: 0, z: 0 }),
      extrude: 30,
    });
    expect(byId(grown, "inner")?.depth).toBe(30);
    expect(byId(grown, "b")).toEqual(byId(nested, "b"));
    expect(motionOf({ ...stillAbout({ x: 0, y: 0, z: 0 }), extrude: 3 }).extrude).toBe(0);
  });

  test("an edit of a group's box carries its members by the motion of its base", () => {
    const outer = byId(nested, "outer");
    if (outer === undefined) return;
    const lifted = editItem(nested, { ...outer, z: 40 });
    expect(["outer", "a", "inner", "b"].map((id) => byId(lifted, id)?.z)).toEqual([40, 40, 40, 40]);
    // A reshape from its corner or an extrude moves it nowhere, so nothing follows, turned or not.
    for (const reshaped of [
      { ...outer, depth: 20 },
      { ...outer, width: 600, height: 100 },
    ]) {
      expect(byId(editItem(nested, reshaped), "a")).toBe(byId(nested, "a"));
    }
    const tilted = { ...outer, rotation: { x: 40 } };
    const tiltedDoc = editItem(nested, tilted);
    const a = byId(tiltedDoc, "a");
    expect(byId(editItem(tiltedDoc, { ...tilted, depth: 30, width: 500 }), "a")).toBe(a);
    const turned = editItem(nested, { ...outer, rotation: { z: 90 } });
    expect(byId(turned, "inner")?.rotation).toEqual({ z: 90 });
    // An item with no members is just written.
    const loose = byId(nested, "loose");
    if (loose === undefined) return;
    expect(editItem(nested, { ...loose, x: 1 }).nodes.filter((n) => n.id !== "loose")).toEqual(
      nested.nodes.filter((n) => n.id !== "loose"),
    );
  });

  test("a copy takes members and the edges inside, and a paste gives them new ids and groups", () => {
    const part = carriedPart(nested, ["inner"]);
    expect(ids(part.nodes)).toEqual(["inner", "b"]);
    expect(part.edges).toEqual([]);
    let n = 0;
    const pasted = pasteItems(nested, part, { x: 300, y: 0 }, () => `n${++n}`);
    expect(pasted.nodeIds).toEqual(["n1"]);
    // The member belongs to its group's copy; the copy lands outside every frame.
    expect(byId(pasted.doc, "n2")?.parent).toBe("n1");
    expect(byId(pasted.doc, "n1")?.parent).toBeUndefined();
    // A clipboard of groups on a cycle lands loose: every item placed and selected.
    const cyclic: CanvasDoc = {
      nodes: [frame("p", [900, 900, 100, 100], "q"), frame("q", [1100, 900, 100, 100], "p")],
      edges: [],
    };
    let m = 0;
    const loose = pasteItems(nested, cyclic, { x: 0, y: 0 }, () => `m${++m}`);
    expect(loose.nodeIds).toEqual(["m1", "m2"]);
    expect(loose.doc.nodes.filter((c) => c.parent !== undefined).map((c) => c.id)).toEqual([
      "a",
      "inner",
      "b",
    ]);
    const inside = pasteItems(
      nested,
      carriedPart(nested, ["loose"]),
      { x: -560, y: 200 },
      () => "c",
    );
    expect(byId(inside.doc, "c")?.parent).toBe("outer");
  });
});

describe("placing and letting go", () => {
  test("an item joins the innermost frame its centre is over, and leaves one it is not", () => {
    const into = nested.nodes.map((n) => (n.id === "loose" ? { ...n, x: 250, y: 200 } : n));
    expect(byId(settleMembership({ ...nested, nodes: into }, ["loose"]), "loose")?.parent).toBe(
      "inner",
    );
    const out = nested.nodes.map((n) => (n.id === "b" ? { ...n, x: 900 } : n));
    expect(byId(settleMembership({ ...nested, nodes: out }, ["b"]), "b")).not.toHaveProperty(
      "parent",
    );
    // Where it already belongs, nothing changes.
    expect(settleMembership(nested, ["a", "b"])).toBe(nested);
  });

  test("into the frame nested deepest, though an outer one stands higher and paints on top", () => {
    const raised = nested.nodes.map((n) => (n.id === "outer" ? { ...n, z: 50 } : n));
    const moved = raised.map((n) => (n.id === "loose" ? { ...n, x: 250, y: 200 } : n));
    expect(byId(settleMembership({ nodes: moved, edges: [] }, ["loose"]), "loose")?.parent).toBe(
      "inner",
    );
  });

  test("never into a frame smaller than it, nor into one of its own members", () => {
    const big = frame("big", [180, 80, 500, 500]);
    const doc = { nodes: [...nested.nodes, big], edges: [] };
    expect(byId(settleMembership(doc, ["big"]), "big")).not.toHaveProperty("parent");
    const outer = settleMembership(
      { nodes: nested.nodes.map((n) => (n.id === "outer" ? { ...n, x: 150 } : n)), edges: [] },
      ["outer"],
    );
    expect(byId(outer, "outer")).not.toHaveProperty("parent");
  });
});

describe("⌘G and ⌘⇧G", () => {
  test("a group gathers the items into a frame round them, just before the first of them", () => {
    const grouped = groupItems(nested, ["a", "inner"], "g", 10);
    expect(ids(grouped.nodes)).toEqual(["g", "a", "outer", "inner", "b", "loose"]);
    expect(byId(grouped, "g")).toEqual({
      id: "g",
      type: "group",
      x: 10,
      y: 10,
      width: 360,
      height: 260,
      parent: "outer",
    });
    expect(["a", "inner", "b"].map((id) => byId(grouped, id)?.parent)).toEqual(["g", "g", "inner"]);
    // A frame round one item holds it, padded or not: letting it go where it was keeps it.
    for (const pad of [20, 0]) {
      const one = groupItems(nested, ["loose"], "g", pad);
      expect(byId(one, "g")?.width).toBe(40 + pad * 2);
      expect(byId(settleMembership(one, ["loose"]), "loose")?.parent).toBe("g");
    }
    // Items from different groups make a group of the canvas.
    expect(byId(groupItems(nested, ["a", "loose"], "h"), "h")).not.toHaveProperty("parent");
    expect(groupItems(nested, ["ghost"], "x")).toBe(nested);
  });

  test("ungrouping drops the group and its edges; its members belong where it did", () => {
    const { doc, released } = ungroupItems(nested, ["inner", "a"]);
    expect(released).toEqual(["b"]);
    expect(ids(doc.nodes)).toEqual(["a", "outer", "b", "loose"]);
    expect(byId(doc, "b")?.parent).toBe("outer");
    expect(doc.edges).toEqual([]);
    // Taken apart together, nested groups release into the first that stays.
    const both = ungroupItems(nested, ["outer", "inner"]);
    expect(both.released).toEqual(["a", "b"]);
    expect(byId(both.doc, "b")).not.toHaveProperty("parent");
    expect(ungroupItems(nested, ["a"]).doc).toBe(nested);
  });
});
