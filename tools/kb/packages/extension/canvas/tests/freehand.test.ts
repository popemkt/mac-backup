/**
 * Freehand strokes (`paths.ts`): a path drawn by hand runs smoothly through
 * its points, by the one smoothing every painter draws it with; a
 * highlighter's stroke is wide, translucent and behind what lies with it.
 */
import { describe, expect, test } from "bun:test";
import {
  freehandItem,
  itemOutline,
  itemPaint,
  paintOrder,
  parseCanvasDoc,
  smoothThrough,
  stringifyCanvasDoc,
  type CanvasNode,
  type CanvasPathNode,
} from "../src/index.ts";

const zigzag = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
  { x: 20, y: 0 },
  { x: 30, y: 10 },
];

/** The commands an item's outline is drawn with, in order. */
const kinds = (item: CanvasNode) => itemOutline(item, item.width, item.height, 0).map((c) => c[0]);

/** The items' ids in the order they are painted. */
const ids = (nodes: readonly CanvasNode[]) => paintOrder(nodes).map((n) => n.id);

describe("a freehand line", () => {
  test("runs smoothly through every point it was drawn through", () => {
    const outline = smoothThrough(zigzag, false);
    expect(outline[0]).toEqual(["M", 0, 0]);
    expect(outline.slice(1).map((c) => c[0])).toEqual(["C", "C", "C"]);
    expect(outline.slice(1).map((c) => c.slice(-2))).toEqual([
      [10, 10],
      [20, 0],
      [30, 10],
    ]);
    // Through the middle point it heads along the line from the one before to the one after.
    const [, , into, out] = [outline[0], outline[1], outline[1], outline[2]];
    expect(into?.[3]).toBeCloseTo(10 - 20 / 6);
    expect(out?.[1]).toBeCloseTo(10 + 20 / 6);
  });

  test("closed, it runs on round to its first", () => {
    const outline = smoothThrough(zigzag, true);
    expect(outline.at(-1)).toEqual(["Z"]);
    expect(outline.at(-2)?.slice(-2)).toEqual([0, 0]);
  });

  test("a path drawn by hand is drawn smooth; any other straight between its points", () => {
    const stroke = freehandItem("p", zigzag, false);
    expect(stroke).not.toBeNull();
    if (stroke === null) return;
    expect(kinds(stroke)).toEqual(["M", "C", "C", "C"]);
    const { freehand: _, ...straight } = stroke;
    expect(kinds(straight)).toEqual(["M", "L", "L", "L"]);
  });

  test("a stroke becomes a path over its bounds, its points kept a step apart", () => {
    const stroke = freehandItem(
      "p",
      [
        { x: 100, y: 50 },
        { x: 100.5, y: 50.5 },
        { x: 140, y: 50 },
        { x: 140.4, y: 50 },
      ],
      false,
    );
    expect(stroke).toMatchObject({ x: 100, y: 50, height: 1, freehand: true });
    expect(stroke?.width).toBeCloseTo(40.4);
    expect(stroke?.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(stroke?.highlight).toBeUndefined();
    expect(
      freehandItem(
        "q",
        [
          { x: 1, y: 1 },
          { x: 1.5, y: 1 },
        ],
        false,
      ),
    ).toBeNull();
  });

  test("is read and written as a path that says it was drawn by hand", () => {
    const stroke = freehandItem("p", zigzag, true);
    const raw = { nodes: [stroke], edges: [] };
    expect(JSON.parse(stringifyCanvasDoc(parseCanvasDoc(raw)))).toEqual(raw);
  });
});

describe("a highlighter's stroke", () => {
  const plain = freehandItem("pen", zigzag, false) as CanvasPathNode;
  const marker = freehandItem("marker", zigzag, true) as CanvasPathNode;

  test("is wide, translucent and yellow unless its paint names a colour; its ends round", () => {
    const [pen, mark] = [itemPaint(plain), itemPaint(marker)];
    expect(mark.chrome?.outline?.width).toBeGreaterThan(4 * (pen.chrome?.outline?.width ?? 0));
    expect(mark.opacity).toBeLessThan(pen.opacity);
    expect(mark.chrome?.stroke.of).toEqual({ kind: "palette", id: "3" });
    expect(itemPaint({ ...marker, color: "5" }).chrome?.stroke.of).toEqual({
      kind: "palette",
      id: "5",
    });
    expect([pen.chrome?.round, mark.chrome?.round]).toEqual([true, true]);
  });

  test("goes behind what lies with it, and in its frame stays over the frame", () => {
    const note: CanvasNode = { id: "n", type: "text", text: "n", x: 0, y: 0, width: 9, height: 9 };
    const frame: CanvasNode = { id: "f", type: "group", x: 0, y: 0, width: 99, height: 99 };
    expect(ids([note, marker, plain])).toEqual(["marker", "n", "pen"]);
    expect(ids([frame, note, { ...marker, parent: "f" }])).toEqual(["f", "marker", "n"]);
  });
});
