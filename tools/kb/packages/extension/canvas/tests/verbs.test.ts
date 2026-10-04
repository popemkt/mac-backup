/**
 * The agent verbs' pure halves (plan 2026-10-02, decision 16): relations in
 * plain words that read both ways — placed `side` of an item is described
 * as `side` of it — placement through the transform, surface snap,
 * membership and the drop rule, layouts, edges, promotion, lints and their
 * diff, and a description at three levels of detail.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  CANVAS_DIRECTIONS,
  arrangeItems,
  canvasMembership,
  connectItems,
  describeCanvas,
  directionFrom,
  facingSides,
  groupItems,
  itemBounds,
  itemKind,
  lintCanvas,
  lintDiff,
  makeItem,
  overlaps,
  parseCanvasDoc,
  placeItem,
  promoteItem,
  promotableText,
  restingOn,
  CanvasRelationError,
  type CanvasDoc,
  type CanvasNode,
} from "../src/index.ts";

/** An item as an agent would write it, read through the document's own parser. */
const node = (raw: Record<string, unknown>): CanvasNode => {
  const [parsed] = parseCanvasDoc({ nodes: [raw] }).nodes;
  if (parsed === undefined) throw new Error("not an item");
  return parsed;
};
type More = Record<string, unknown>;
const card = (id: string, x: number, y: number, more: More = {}) =>
  node({ id, type: "text", text: id, x, y, width: 100, height: 60, ...more });
const box = (id: string, x: number, y: number, more: More = {}) =>
  node({ id, type: "shape", shape: "rect", x, y, width: 120, height: 120, depth: 120, ...more });
const frame = (id: string, [x, y, w, h]: readonly number[], more: More = {}) =>
  node({ id, type: "group", label: id, x, y, width: w, height: h, ...more });
const doc = (...nodes: CanvasNode[]): CanvasDoc => ({ nodes, edges: [] });
const item = (d: CanvasDoc, id: string) => {
  const found = d.nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};
/** The rules of the lints on `d`, its store holding only node `n.here`. */
const all = (d: CanvasDoc) => lintCanvas(d, (id) => id === "n.here").map((l) => l.rule);
/** The store's one node text, for a description. */
const text = (id: string) => (id === "n.idea" ? "An idea" : undefined);
const where = (d: CanvasDoc, a: string, b: string) =>
  directionFrom(itemBounds(item(d, a)), itemBounds(item(d, b)));

describe("directions read both ways", () => {
  test("an item placed on a side of another, a gap away, is described on that side with that gap", () => {
    fc.assert(
      fc.property(
        fc.record({
          side: fc.constantFrom(...CANVAS_DIRECTIONS),
          gap: fc.integer({ min: 1, max: 200 }),
          x: fc.integer({ min: -400, max: 400 }),
          y: fc.integer({ min: -400, max: 400 }),
          width: fc.integer({ min: 20, max: 300 }),
          height: fc.integer({ min: 20, max: 300 }),
          turn: fc.integer({ min: -90, max: 90 }),
        }),
        ({ side, gap, x, y, width, height, turn }) => {
          const target = box("t", x, y, { width, height, rotation: { z: turn } });
          const placed = placeItem(doc(target), makeItem({ preset: "text" }, "n"), {
            near: "t",
            side,
            gap,
          });
          const read = where(placed.doc, "n", "t");
          expect(read?.direction).toBe(side);
          expect(read?.gap).toBeCloseTo(gap, 3);
        },
      ),
      { numRuns: 120 },
    );
  });

  test("touching a solid from below, a flat item would be at its base, in it: it steps clear", () => {
    const placed = placeItem(doc(box("t", 0, 0)), makeItem({ preset: "text" }, "n"), {
      near: "t",
      side: "below",
      gap: 0,
    });
    expect(where(placed.doc, "n", "t")).toEqual({ direction: "below", gap: 20 });
  });

  test("bounds that overlap along every axis have no direction; touching ones a gap of 0", () => {
    expect(directionFrom(itemBounds(card("a", 0, 0)), itemBounds(card("b", 50, 20)))).toBeNull();
    expect(directionFrom(itemBounds(card("a", 0, 0)), itemBounds(card("b", 100, 0)))).toEqual({
      direction: "left",
      gap: 0,
    });
  });

  test("an edge leaves and arrives by the sides facing each other", () => {
    expect(facingSides(card("a", 0, 0), card("b", 300, 10))).toEqual({
      fromSide: "right",
      toSide: "left",
    });
    expect(facingSides(card("a", 0, 300), card("b", 0, 0))).toEqual({
      fromSide: "top",
      toSide: "bottom",
    });
  });
});

describe("overlap", () => {
  test("two solids running into each other overlap; touching ones do not", () => {
    expect(overlaps(box("a", 0, 0), box("b", 60, 60))).toBe(true);
    expect(overlaps(box("a", 0, 0), box("b", 120, 0))).toBe(false);
  });

  test("a card on a box's top rests on it; one inside it, or at its base, overlaps it", () => {
    expect(overlaps(card("c", 10, 10, { z: 120 }), box("b", 0, 0))).toBe(false);
    expect(overlaps(card("c", 10, 10, { z: 60 }), box("b", 0, 0))).toBe(true);
    expect(overlaps(card("c", 10, 10), box("b", 0, 0))).toBe(true);
  });

  test("cards on one plane overlap, on two do not; a frame overlaps nothing", () => {
    expect(overlaps(card("a", 0, 0), card("b", 50, 0))).toBe(true);
    expect(overlaps(card("a", 0, 0), card("b", 50, 0, { z: 40 }))).toBe(false);
    expect(overlaps(frame("f", [0, 0, 300, 300]), card("a", 10, 10))).toBe(false);
  });
});

describe("place", () => {
  test("beside an item on the floor plan, level with it: on the shelf it stands on", () => {
    const shelf = box("shelf", 0, 0, { width: 500, height: 200, depth: 40 });
    const target = card("t", 20, 20, { z: 40 });
    const placed = placeItem(doc(shelf, target), makeItem({ preset: "text" }, "n"), {
      near: "t",
      side: "right",
      gap: 80,
    });
    expect(item(placed.doc, "n").z).toBe(40);
    expect(restingOn(item(placed.doc, "n"), placed.doc.nodes)?.id).toBe("shelf");
    expect(where(placed.doc, "n", "t")).toEqual({ direction: "right", gap: 80 });
  });

  test("a spot that is taken steps further out by the grid until it is clear", () => {
    const placed = placeItem(
      doc(card("t", 0, 0), box("block", 120, 0)),
      makeItem({ preset: "text" }, "n"),
      {
        near: "t",
        side: "right",
      },
    );
    const n = item(placed.doc, "n");
    expect(overlaps(n, item(placed.doc, "block"))).toBe(false);
    expect(where(placed.doc, "n", "t")?.direction).toBe("right");
    expect(n.x).toBeGreaterThanOrEqual(240);
  });

  test("on an item: centred on its top, standing on it", () => {
    const placed = placeItem(doc(box("b", 0, 0)), makeItem({ preset: "text" }, "n"), { on: "b" });
    const n = item(placed.doc, "n");
    expect(n.z).toBe(120);
    expect(n.x + n.width / 2).toBeCloseTo(60, 6);
    expect(restingOn(n, placed.doc.nodes)?.id).toBe("b");
  });

  test("in a frame on the floor: inside it, a member, clear of its other members", () => {
    const f = frame("f", [0, 0, 400, 300]);
    const first = placeItem(doc(f), makeItem({ preset: "text" }, "a"), { in: "f" });
    const second = placeItem(first.doc, makeItem({ preset: "text" }, "b"), { in: "f" });
    const m = canvasMembership(second.doc.nodes);
    expect(m.parentOf("a")).toBe("f");
    expect(m.parentOf("b")).toBe("f");
    expect(overlaps(item(second.doc, "a"), item(second.doc, "b"))).toBe(false);
  });

  test("in a frame stood up as a wall: laid on its face, turned as it is, a member", () => {
    const wall = frame("w", [0, 0, 400, 300], { rotation: { x: 90 } });
    const placed = placeItem(doc(wall), makeItem({ preset: "text" }, "n"), { in: "w" });
    const n = item(placed.doc, "n");
    expect(n.rotation).toEqual({ x: 90 });
    expect(canvasMembership(placed.doc.nodes).parentOf("n")).toBe("w");
  });

  test("in something that is not a frame, or a frame too small, is refused", () => {
    expect(() =>
      placeItem(doc(card("t", 0, 0)), makeItem({ preset: "text" }, "n"), { in: "t" }),
    ).toThrow(CanvasRelationError);
    expect(() =>
      placeItem(doc(frame("f", [0, 0, 40, 40])), makeItem({ preset: "text" }, "n"), { in: "f" }),
    ).toThrow("does not fit");
  });

  test("an item that is not there is named in the refusal", () => {
    expect(() =>
      placeItem(doc(), makeItem({ preset: "text" }, "n"), { near: "ghost", side: "left" }),
    ).toThrow("ghost");
  });

  test("at plain coordinates; with no height it stands on what is under it", () => {
    const placed = placeItem(doc(box("b", 0, 0)), makeItem({ preset: "text" }, "n"), {
      at: { x: 10, y: 20 },
    });
    expect(item(placed.doc, "n")).toMatchObject({ x: 10, y: 20, z: 120 });
    const held = placeItem(doc(), makeItem({ preset: "text" }, "m"), { at: { x: 0, y: 0, z: 40 } });
    expect(item(held.doc, "m").z).toBe(40);
  });

  test("moving a frame carries its members; a frame cannot be placed by its own member", () => {
    const f = frame("f", [0, 0, 300, 200]);
    const inside = card("in", 20, 20, { parent: "f" });
    const other = card("o", 600, 0);
    const placed = placeItem(doc(f, inside, other), f, { near: "o", side: "south", gap: 40 });
    const moved = item(placed.doc, "f");
    expect(item(placed.doc, "in").x - moved.x).toBeCloseTo(20, 6);
    expect(item(placed.doc, "in").y - moved.y).toBeCloseTo(20, 6);
    expect(() => placeItem(doc(f, inside), f, { near: "in", side: "left" })).toThrow("carries");
  });
});

describe("arrange", () => {
  const three = doc(card("a", 0, 0), card("b", 500, 300), card("c", 40, 900));

  test("a row keeps the set's top left and the gap between neighbours", () => {
    const row = arrangeItems(three, ["a", "b", "c"], { layout: "row", gap: 20 });
    expect(where(row, "b", "a")).toEqual({ direction: "right", gap: 20 });
    expect(where(row, "c", "b")).toEqual({ direction: "right", gap: 20 });
    expect(item(row, "a")).toMatchObject({ x: 0, y: 0 });
  });

  test("a column, a grid and a ring each leave every item clear of the others", () => {
    for (const layout of ["column", "grid", "ring"] as const) {
      const laid = arrangeItems(three, ["a", "b", "c"], { layout });
      const [a, b, c] = ["a", "b", "c"].map((id) => item(laid, id));
      if (a === undefined || b === undefined || c === undefined) throw new Error("missing");
      expect([overlaps(a, b), overlaps(b, c), overlaps(a, c)]).toEqual([false, false, false]);
    }
    const column = arrangeItems(three, ["a", "b", "c"], { layout: "column" });
    expect(where(column, "b", "a")?.direction).toBe("south");
  });

  test("a stack stands each on the one before, over the first", () => {
    const stacked = arrangeItems(
      doc(box("a", 0, 0), box("b", 300, 0), card("c", 600, 0)),
      ["a", "b", "c"],
      {
        layout: "stack",
      },
    );
    expect(restingOn(item(stacked, "b"), stacked.nodes)?.id).toBe("a");
    expect(restingOn(item(stacked, "c"), stacked.nodes)?.id).toBe("b");
  });

  test("layers lift each item to its value's layer, the unvalued lowest", () => {
    const values: Record<string, string | undefined> = { a: "doing", b: "done", c: undefined };
    const layered = arrangeItems(three, ["a", "b", "c"], {
      layout: "layers",
      gap: 100,
      layerOf: (it) => values[it.id],
    });
    expect([item(layered, "c").z ?? 0, item(layered, "a").z, item(layered, "b").z]).toEqual([
      0, 100, 200,
    ]);
    expect(item(layered, "b")).toMatchObject({ x: 500, y: 300 });
  });

  test("a frame laid out carries its members", () => {
    const d = doc(
      frame("f", [0, 0, 200, 200]),
      card("m", 20, 20, { parent: "f" }),
      card("o", 0, 600),
    );
    const row = arrangeItems(d, ["o", "f"], { layout: "row" });
    expect(item(row, "m").x - item(row, "f").x).toBeCloseTo(20, 6);
    expect(canvasMembership(row.nodes).parentOf("m")).toBe("f");
  });
});

describe("connect", () => {
  test("an arrow between facing sides, recording the nodes its ends stand for", () => {
    const d = doc(card("a", 0, 0, { nodeId: "n.a" }), card("b", 400, 0));
    const { edge } = connectItems(d, {
      id: "e",
      bindingId: "k",
      from: "a",
      to: "b",
      label: "leads to",
    });
    expect(edge).toMatchObject({
      fromSide: "right",
      toSide: "left",
      toEnd: "arrow",
      label: "leads to",
      kbLink: { mode: "layout", sourceNodeId: "n.a", targetNodeId: "" },
    });
  });

  test("a bound edge needs a node at each end, and two distinct items", () => {
    const d = doc(
      card("a", 0, 0, { nodeId: "n.a" }),
      card("b", 400, 0, { nodeId: "n.b" }),
      card("c", 0, 400),
    );
    const bound = connectItems(d, {
      id: "e",
      bindingId: "k",
      from: "a",
      to: "b",
      bindField: "f.rel",
    });
    expect(bound.edge.kbLink).toMatchObject({
      mode: "native",
      fieldId: "f.rel",
      targetNodeId: "n.b",
    });
    expect(() =>
      connectItems(d, { id: "e", bindingId: "k", from: "a", to: "c", bindField: "f" }),
    ).toThrow(CanvasRelationError);
    expect(() => connectItems(d, { id: "e", bindingId: "k", from: "a", to: "a" })).toThrow();
  });
});

describe("promote", () => {
  test("a text card becomes a card of its node, its box, colour and frame kept", () => {
    const d = doc(
      frame("f", [0, 0, 400, 400]),
      card("s", 20, 20, { color: "3", parent: "f", z: 0 }),
    );
    expect(promotableText(d, "s")).toBe("s");
    const promoted = item(promoteItem(d, "s", "n.s"), "s");
    expect(promoted).toMatchObject({
      type: "kb-node",
      nodeId: "n.s",
      color: "3",
      parent: "f",
      x: 20,
    });
    expect("text" in promoted).toBe(false);
  });

  test("a shape, an item that already means a node, or one that says nothing is refused", () => {
    const d = doc(
      box("b", 0, 0),
      card("c", 0, 0, { nodeId: "n.c" }),
      card("e", 0, 0, { text: " " }),
    );
    expect(() => promotableText(d, "b")).toThrow("only a text card");
    expect(() => promotableText(d, "c")).toThrow("already");
    expect(() => promotableText(d, "e")).toThrow("nothing");
  });
});

describe("lints", () => {
  test("each rule, and a clean canvas has none", () => {
    expect(all(doc(card("a", 0, 0), box("b", 300, 0)))).toEqual([]);
    expect(all(doc(box("a", 0, 0), box("b", 50, 50)))).toEqual(["overlap"]);
    expect(all(doc(card("a", 0, 0, { z: 90 })))).toEqual(["floating"]);
    expect(all(doc(card("a", 0, 0, { nodeId: "n.gone" })))).toEqual(["missing-node"]);
    expect(all(doc(card("a", 0, 0, { parent: "nope" })))).toEqual(["missing-group"]);
    expect(all(doc(frame("f", [0, 0, 100, 100]), card("a", 500, 500, { parent: "f" })))).toEqual([
      "outside-frame",
    ]);
    expect(
      all({ nodes: [card("a", 0, 0)], edges: [{ id: "e", fromNode: "a", toNode: "gone" }] }),
    ).toEqual(["missing-end"]);
  });

  test("what rests on a solid or lies on a wall's face does not float", () => {
    expect(all(doc(box("b", 0, 0), card("a", 10, 10, { z: 120 })))).toEqual([]);
    const wall = frame("w", [0, 0, 400, 300], { rotation: { x: 90 } });
    const placed = placeItem(doc(wall), makeItem({ preset: "text" }, "n"), { in: "w" });
    expect(all(placed.doc)).toEqual([]);
  });

  test("a diff names the lints a write made and the ones it cleared", () => {
    const before = lintCanvas(doc(card("a", 0, 0, { z: 90 })), () => true);
    const after = lintCanvas(doc(card("a", 0, 0), box("b", 0, 0)), () => true);
    const diff = lintDiff(before, after);
    expect(diff.new.map((l) => l.rule)).toEqual(["overlap"]);
    expect(diff.resolved.map((l) => l.rule)).toEqual(["floating"]);
  });
});

describe("describe", () => {
  const d: CanvasDoc = {
    nodes: [
      frame("f", [0, 0, 600, 400]),
      box("b", 20, 20, { parent: "f" }),
      card("on", 30, 30, { z: 120, parent: "f" }),
      card("idea", 200, 20, { type: "kb-node", nodeId: "n.idea", parent: "f" }),
      card("far", 3000, 3000),
    ],
    edges: [{ id: "e", fromNode: "on", toNode: "idea", label: "why" }],
  };

  test("in full: each item's kind, words and box, and how they stand to one another", () => {
    const told = describeCanvas(d, { nodeText: text });
    expect(told.items.map((i) => [i.id, i.kind, i.words])).toEqual([
      ["f", "frame", "f"],
      ["b", "box", ""],
      ["on", "text", "on"],
      ["idea", "card", "An idea"],
      ["far", "text", "far"],
    ]);
    expect(told.items.find((i) => i.id === "b")?.box).toEqual({
      min: { x: 20, y: 20, z: 0 },
      max: { x: 140, y: 140, z: 120 },
    });
    expect(told.relations).toContainEqual({ kind: "on", from: "on", to: "b" });
    expect(told.relations).toContainEqual({ kind: "in", from: "b", to: "f" });
    expect(told.relations).toContainEqual({
      kind: "linked",
      from: "on",
      to: "idea",
      edge: "e",
      label: "why",
    });
    expect(told.relations).toContainEqual({
      kind: "near",
      from: "b",
      to: "idea",
      side: "left",
      gap: 60,
    });
  });

  test("focused in full, the rest on screen blurred, what is off screen counted by frame", () => {
    const told = describeCanvas(d, {
      nodeText: text,
      focus: new Set(["idea"]),
      visible: new Set(["f", "b", "on", "idea"]),
    });
    expect(told.items.map((i) => [i.id, i.detail])).toEqual([
      ["f", "blurry"],
      ["b", "blurry"],
      ["on", "blurry"],
      ["idea", "focus"],
    ]);
    expect(told.peripheral).toEqual([{ frame: null, count: 1, kinds: { text: 1 } }]);
    expect(told.relations.every((r) => r.from === "idea" || r.to === "idea")).toBe(true);
  });

  test("an item's kind is what a person calls it", () => {
    expect(itemKind(box("b", 0, 0, { shape: "ellipse" }))).toBe("cylinder");
    expect(itemKind(box("b", 0, 0, { depth: 0 }))).toBe("rect");
    expect(itemKind(card("l", 0, 0, { billboard: true }))).toBe("label");
    expect(itemKind(makeItem({ preset: "sphere" }, "s"))).toBe("sphere");
  });
});

describe("make", () => {
  test("a preset with words, look and size; a card needs a node and a picture an asset", () => {
    expect(makeItem({ preset: "rect", text: "Plan", color: "4", width: 200 }, "r")).toMatchObject({
      type: "shape",
      label: "Plan",
      color: "4",
      width: 200,
    });
    expect(makeItem({ preset: "text", text: "Hi", depth: 30 }, "t")).toMatchObject({
      text: "Hi",
      depth: 30,
    });
    expect(() => makeItem({ preset: "kb-node" }, "k")).toThrow("nodeId");
    expect(() => makeItem({ preset: "image" }, "i")).toThrow("asset");
    expect(() => makeItem({ preset: "image", file: "assets/a.png", text: "x" }, "i")).toThrow(
      "no words",
    );
  });

  test("grouping gathers a frame a grid step round its members", () => {
    const grouped = groupItems(doc(card("a", 0, 0), card("b", 200, 0)), ["a", "b"], "g", 20);
    expect(item(grouped, "g")).toMatchObject({ x: -20, y: -20, width: 340, height: 100 });
  });
});
