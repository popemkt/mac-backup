/**
 * The path item (`paths.ts`): a line through points of its box, round-tripped
 * as the format writes it; its outline is its line, and its open ends wear
 * the heads an edge wears. A line is placed from a preset, as any item is,
 * and an agent may give it points and heads.
 */
import { describe, expect, test } from "bun:test";
import {
  describeCanvas,
  headOf,
  isPathNode,
  itemKind,
  itemOutline,
  makeItem,
  outlinePoints,
  parseCanvasDoc,
  pathHeads,
  presetItem,
  stringifyCanvasDoc,
  styleOf,
  withHead,
  withLine,
  type CanvasEdge,
  type CanvasPathNode,
} from "../src/index.ts";

const line = (more: Partial<CanvasPathNode> = {}): CanvasPathNode => ({
  id: "p",
  type: "path",
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  points: [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  ],
  ...more,
});

describe("the format", () => {
  test("a path round-trips, and what kb cannot read in it stays", () => {
    const raw = {
      nodes: [
        {
          id: "p",
          type: "path",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          closed: "maybe",
          toHead: "diamond",
          fromHead: "comet",
        },
      ],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    const [item] = doc.nodes;
    expect(item !== undefined && isPathNode(item)).toBe(true);
    expect(item).toMatchObject({ toHead: "diamond" });
    expect(item?.extra).toEqual({ closed: "maybe", fromHead: "comet" });
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
  });

  test("a path whose points cannot be read is kept as written, an item kb does not know", () => {
    const raw = {
      nodes: [
        { id: "p", type: "path", x: 0, y: 0, width: 10, height: 10, points: [{ x: 2, y: 0 }] },
      ],
      edges: [],
    };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes[0] !== undefined && isPathNode(doc.nodes[0])).toBe(false);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
  });
});

describe("drawn", () => {
  test("its outline is the line through its points across its box, closed when it closes", () => {
    expect(itemOutline(line(), 200, 100, 8)).toEqual([
      ["M", 0, 100],
      ["L", 200, 0],
    ]);
    expect(itemOutline(line({ closed: true }), 200, 100, 8).at(-1)).toEqual(["Z"]);
  });

  test("its open ends wear its heads, pointing out of the line; a closed one has no ends", () => {
    const heads = pathHeads(line({ fromHead: "dot", toHead: "arrow" }), 200, 100, 10);
    expect(heads.map(({ end, head }) => [end, head.kind])).toEqual([
      ["from", "dot"],
      ["to", "arrow"],
    ]);
    const arrow = heads[1]?.head;
    expect(arrow?.path[0]).toEqual(["M", 200, 0]);
    const xs = outlinePoints(arrow?.path ?? []).map(([x]) => x);
    expect(Math.min(...xs)).toBeLessThan(200);
    expect(pathHeads(line({ toHead: "arrow", closed: true }), 200, 100, 10)).toEqual([]);
  });

  test("a line is unfilled by default, and is told as a line or an arrow", () => {
    expect(styleOf(line()).fill).toBe("none");
    expect(itemKind(line())).toBe("line");
    expect(itemKind(line({ toHead: "arrow" }))).toBe("arrow");
    expect(itemKind(line({ closed: true }))).toBe("outline");
  });
});

describe("made", () => {
  test("the line and arrow presets run left to right across their box", () => {
    const arrow = presetItem("arrow", { x: 5, y: 6 }, "a");
    expect(arrow).toMatchObject({ type: "path", toHead: "arrow", x: 5, y: 6 });
    expect(isPathNode(presetItem("line", { x: 0, y: 0 }, "l"))).toBe(true);
  });

  test("an agent's line takes its points and heads; anything else takes none", () => {
    const made = makeItem(
      {
        preset: "arrow",
        line: {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 1 },
            { x: 1, y: 0 },
          ],
          fromHead: "bar",
        },
      },
      "a",
    );
    expect(made).toMatchObject({ fromHead: "bar", toHead: "arrow" });
    expect(isPathNode(made) && made.points.length).toBe(3);
    expect(() => makeItem({ preset: "rect", line: { closed: true } }, "r")).toThrow();
    expect(() => makeItem({ preset: "line", text: "hi" }, "l")).toThrow();
  });

  test("a head set to none, or a line opened, is written as no field", () => {
    const worn = withLine(line({ toHead: "arrow", closed: true }), { toHead: null, closed: false });
    expect(worn).toEqual(line());
  });

  test("describe tells a line by its kind", () => {
    const told = describeCanvas(
      { nodes: [line({ toHead: "open" })], edges: [] },
      { nodeText: () => undefined },
    );
    expect(told.items[0]).toMatchObject({ id: "p", kind: "arrow" });
  });
});

describe("ends", () => {
  test("a line's ends read and write as an edge's do: the head each end wears, or none", () => {
    const edge: CanvasEdge = { id: "e", fromNode: "a", toNode: "b" };
    const records = [line(), edge] as const;
    for (const record of records) {
      for (const [end, head] of [
        ["from", "dot"],
        ["to", "open"],
        ["to", null],
      ] as const) {
        const worn = record === edge ? withHead(edge, end, head) : withHead(line(), end, head);
        expect(headOf(worn, end), `${"type" in record ? "line" : "edge"} ${end}`).toBe(head);
      }
    }
    // Each keeps its own default: a line leaves and arrives bare, an edge arrives with an arrow.
    expect([headOf(line(), "from"), headOf(line(), "to")]).toEqual([null, null]);
    expect([headOf(edge, "from"), headOf(edge, "to")]).toEqual([null, "arrow"]);
  });

  test("a closed line has no ends, so wears no head", () => {
    expect(headOf(line({ closed: true, toHead: "arrow" }), "to")).toBeNull();
  });
});
