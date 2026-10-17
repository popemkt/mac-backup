/**
 * An item's looks (DESIGN.md → Canvas documents, `style`): every look kb
 * reads round-trips, a look or a value it cannot read survives untouched
 * until kb writes that look, a default is written as nothing, and one reader
 * (`styleOf`) gives every renderer the look with its kind's defaults. The
 * palette is named, and a name is written as the JSON Canvas preset.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  canvasWorld,
  CANVAS_ALIGNS,
  CANVAS_DASHES,
  CANVAS_FILLS,
  CANVAS_FONTS,
  CANVAS_PALETTE,
  CANVAS_SIZES,
  CANVAS_VALIGNS,
  canvasColor,
  describeCanvas,
  makeItem,
  parseCanvasDoc,
  stringifyCanvasDoc,
  styleOf,
  withStyle,
  type CanvasDoc,
  type CanvasNode,
} from "../src/index.ts";

const roundTrip = (doc: CanvasDoc) => parseCanvasDoc(stringifyCanvasDoc(doc));

const looksArb = fc.record(
  {
    fill: fc.constantFrom(...CANVAS_FILLS),
    dash: fc.constantFrom(...CANVAS_DASHES),
    size: fc.constantFrom(...CANVAS_SIZES),
    font: fc.constantFrom(...CANVAS_FONTS),
    align: fc.constantFrom(...CANVAS_ALIGNS),
    valign: fc.constantFrom(...CANVAS_VALIGNS),
    opacity: fc.double({ noNaN: true, min: 0, max: 1 }).map((v) => v + 0),
  },
  { requiredKeys: [] },
);

const item = (over: Partial<CanvasNode> & { type?: string } = {}): CanvasNode =>
  ({ id: "a", type: "text", text: "", x: 0, y: 0, width: 100, height: 60, ...over }) as CanvasNode;
const frameItem = (): CanvasNode => ({
  id: "f",
  type: "group",
  x: 0,
  y: 0,
  width: 100,
  height: 60,
});

describe("the style field", () => {
  test("any looks kb reads come back as themselves", () => {
    fc.assert(
      fc.property(looksArb, fc.constantFrom("text", "shape", "group"), (style, type) => {
        const kinds = { text: { text: "" }, shape: { shape: "rect" }, group: {} } as const;
        const node = { ...frameItem(), type, ...kinds[type], style };
        const doc = { nodes: [node as CanvasNode], edges: [] };
        expect(roundTrip(doc)).toEqual(doc);
      }),
    );
  });

  test("a look or a value kb cannot read is kept verbatim, and a look set replaces it", () => {
    const raw = {
      nodes: [
        {
          ...item(),
          style: { dash: "draw", fill: "solid", glow: 3, opacity: 2 },
        },
      ],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
    const [read] = doc.nodes;
    if (read === undefined) throw new Error("no item");
    expect(styleOf(read).fill).toBe("solid");
    expect(styleOf(read).dash).toBe("solid");
    const set = withStyle(read, { dash: "dashed" });
    expect(set.style).toEqual({ fill: "solid", dash: "dashed", extra: { glow: 3, opacity: 2 } });
  });

  test("a style that is no object stays an unknown field", () => {
    const raw = { nodes: [{ ...item(), style: "bold" }], edges: [] };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes[0]?.style).toBeUndefined();
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
  });

  test("a document without looks is written exactly as before", () => {
    const raw = { nodes: [item()], edges: [] };
    expect(JSON.parse(stringifyCanvasDoc(parseCanvasDoc(raw)))).toEqual(raw);
  });
});

describe("styleOf and withStyle", () => {
  test("every look has its kind's default when unwritten", () => {
    expect(styleOf(item())).toEqual({
      fill: "semi",
      dash: "solid",
      size: "m",
      font: "sans",
      align: "start",
      valign: "top",
      opacity: 1,
    });
    const frame = styleOf(frameItem());
    expect([frame.fill, frame.dash, frame.size]).toEqual(["none", "dashed", "s"]);
    const shape = styleOf({ ...frameItem(), type: "shape", shape: "rect" });
    expect([shape.align, shape.valign]).toEqual(["middle", "middle"]);
  });

  test("a default is written as no look, and an item put back carries no style", () => {
    const frame = frameItem();
    // Solid is a frame's own choice; dashed its default.
    expect(withStyle(frame, { dash: "solid" }).style).toEqual({ dash: "solid" });
    expect(
      withStyle(withStyle(frame, { dash: "solid" }), { dash: "dashed" }).style,
    ).toBeUndefined();
    expect(withStyle(item(), { size: "l", opacity: 1 }).style).toEqual({ size: "l" });
    expect(withStyle(withStyle(item(), { size: "l" }), { size: undefined })).toEqual(item());
  });

  test("the palette is named, and a name is written as its JSON Canvas preset", () => {
    expect(canvasColor("red")).toBe("1");
    expect(canvasColor("Purple")).toBe("6");
    expect(canvasColor("grey")).toBe("grey");
    expect(canvasColor("#ff0000")).toBe("#ff0000");
    for (const { id, name } of CANVAS_PALETTE) {
      expect(styleOf(item({ color: name })).color).toEqual({ kind: "palette", id });
      expect(styleOf(item({ color: id })).color).toEqual({ kind: "palette", id });
    }
    expect(makeItem({ preset: "rect", color: "green" }, "r").color).toBe("4");
  });

  test("a new item is made with its looks, and describe tells them", () => {
    const made = makeItem(
      { preset: "text", text: "hi", style: { font: "mono", dash: "dotted" } },
      "t",
    );
    expect(made.style).toEqual({ dash: "dotted", font: "mono" });
    const told = describeCanvas(
      { nodes: [{ ...made, color: "1" }], edges: [] },
      { world: canvasWorld([]) },
    );
    expect(told.items[0]?.color).toBe("red");
    expect(told.items[0]?.style).toEqual({ dash: "dotted", font: "mono" });
  });
});
