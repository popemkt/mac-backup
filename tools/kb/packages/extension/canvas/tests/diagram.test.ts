/**
 * A diagram drawn as a canvas (DESIGN.md → Canvas documents → Diagram):
 * boxes ranked down the flow, one past the furthest box linking into them,
 * each rank laid out across the flow by `arrangeItems`, and each link an
 * edge bound to its two boxes; and mermaid flowchart text read into the same
 * spec, what kb has no equivalent for drawn as its nearest or reported.
 */
import { describe, expect, test } from "bun:test";
import {
  DIAGRAM_LIMITS,
  diagramDoc,
  isShapeNode,
  mermaidDiagram,
  styleOf,
  type CanvasDoc,
  type CanvasNode,
  type DiagramSpec,
} from "../src/index.ts";

const counter = () => {
  let n = 0;
  return () => `m${++n}`;
};

const card = (key: string) => ({ key, item: { preset: "kb-node" as const, nodeId: `n.${key}` } });

/** a → b, a → c, b → d, c → d, d → a (a cycle back to the top). */
const SPEC: DiagramSpec = {
  flow: "down",
  boxes: ["a", "b", "c", "d"].map(card),
  links: [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
    { from: "b", to: "d" },
    { from: "c", to: "d", label: "joins" },
    { from: "d", to: "a" },
  ],
};

function itemOf(doc: CanvasDoc, id: string): CanvasNode {
  const found = doc.nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`no item ${id}`);
  return found;
}

const centre = (item: CanvasNode) => ({ x: item.x + item.width / 2, y: item.y + item.height / 2 });

describe("diagramDoc", () => {
  const doc = diagramDoc(SPEC, counter());

  test("each box is its item, keyed as named; a card carries its node", () => {
    expect(doc.nodes.map((n) => [n.id, n.type, n.nodeId])).toEqual([
      ["a", "kb-node", "n.a"],
      ["b", "kb-node", "n.b"],
      ["c", "kb-node", "n.c"],
      ["d", "kb-node", "n.d"],
    ]);
  });

  test("ranks run down the flow; a link back up a cycle does not rank", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => centre(itemOf(doc, id)));
    expect(b?.y).toBe(c?.y ?? NaN);
    expect(a?.y).toBeLessThan(b?.y ?? NaN);
    expect(d?.y).toBeGreaterThan(b?.y ?? NaN);
    // One rank is a row: b and c side by side, not overlapping.
    expect(itemOf(doc, "c").x).toBeGreaterThanOrEqual(itemOf(doc, "b").x + itemOf(doc, "b").width);
    // Each rank is centred on the widest.
    expect(a?.x).toBeCloseTo(((b?.x ?? 0) + (c?.x ?? 0)) / 2);
    expect(d?.x).toBeCloseTo(a?.x ?? NaN);
  });

  test("each link is an edge bound to its boxes, the cycle's too", () => {
    expect(doc.edges.map((e) => [e.fromNode, e.toNode, e.label])).toEqual([
      ["a", "b", undefined],
      ["a", "c", undefined],
      ["b", "d", undefined],
      ["c", "d", "joins"],
      ["d", "a", undefined],
    ]);
    expect(new Set(doc.edges.map((e) => e.id)).size).toBe(5);
  });

  test("a flow up is the flow down mirrored; a flow right ranks across", () => {
    const up = diagramDoc({ ...SPEC, flow: "up" }, counter());
    expect(centre(itemOf(up, "a")).y).toBeGreaterThan(centre(itemOf(up, "d")).y);
    const right = diagramDoc({ ...SPEC, flow: "right" }, counter());
    expect(centre(itemOf(right, "a")).x).toBeLessThan(centre(itemOf(right, "b")).x);
    expect(centre(itemOf(right, "b")).x).toBe(centre(itemOf(right, "c")).x);
  });

  test("a link to a box the spec does not hold is refused", () => {
    expect(() => diagramDoc({ ...SPEC, links: [{ from: "a", to: "z" }] }, counter())).toThrow(
      /no box z/,
    );
  });
});

describe("mermaidDiagram", () => {
  test("the header gives the flow; each box its shape and words", () => {
    const { spec, reported } = mermaidDiagram(
      'flowchart LR\n  A[Start] --> B{"Is it; ok?"}\n  B -->|yes| C((Done))\n  B -- no --> D(Retry)',
    );
    expect(spec.flow).toBe("right");
    expect(spec.boxes.map((b) => [b.key, b.item.preset, b.item.text])).toEqual([
      ["A", "rect", "Start"],
      ["B", "diamond", "Is it; ok?"],
      ["C", "ellipse", "Done"],
      ["D", "rect", "Retry"],
    ]);
    expect(spec.links.map((l) => [l.from, l.to, l.label])).toEqual([
      ["A", "B", undefined],
      ["B", "C", "yes"],
      ["B", "D", "no"],
    ]);
    expect(reported).toEqual([]);
  });

  test("a link's line and heads are kb's looks: dotted dashed, thick heavy, bare headless", () => {
    const { spec } = mermaidDiagram("graph TD\nA -.-> B\nB ==> C\nC --- D\nD <--> E\nE --o F");
    const [dotted, thick, bare, both, circle] = spec.links;
    expect(dotted?.style).toEqual({ dash: "dashed" });
    expect(thick?.style).toEqual({ size: "l" });
    expect(bare?.toHead).toBeNull();
    expect([both?.fromHead, both?.toHead]).toEqual(["arrow", undefined]);
    expect(circle?.toHead).toBe("dot");
  });

  test("a chain and a group link every box to the next", () => {
    const { spec } = mermaidDiagram("graph TD; A & B --> C --> D");
    expect(spec.links.map((l) => `${l.from}${l.to}`)).toEqual(["AC", "BC", "CD"]);
  });

  test("what kb has no equivalent for is drawn as its nearest or reported, by line", () => {
    const { spec, reported } = mermaidDiagram(
      [
        "%% a comment",
        "flowchart TD",
        "  subgraph one",
        "    A([Stadium]) --> A",
        "  end",
        "  classDef hot fill:#f00",
        "  B:::hot --x C",
        "  ??? nonsense",
      ].join("\n"),
    );
    expect(spec.boxes.map((b) => b.key)).toEqual(["A", "B", "C"]);
    expect(reported).toEqual([
      { line: 3, note: "kb draws no subgraph" },
      { line: 4, note: "A's stadium is drawn as a rect" },
      { line: 4, note: "A links to itself: not drawn" },
      { line: 6, note: "kb draws no classDef" },
      { line: 7, note: "kb reads no class: B's hot is not drawn" },
      { line: 7, note: "kb has no cross head: it is drawn as a bar" },
      { line: 8, note: "kb could not read it: ??? nonsense" },
    ]);
  });

  test("text that is no flowchart is refused", () => {
    expect(() => mermaidDiagram("sequenceDiagram\nA->>B: hi")).toThrow(/flowchart/);
    expect(() => mermaidDiagram("flowchart XY\nA-->B")).toThrow(/TD, TB, BT, LR or RL/);
  });

  test("its spec draws: shapes worded as mermaid wrote them", () => {
    const { spec } = mermaidDiagram("flowchart TD\nA[Go] --> B{Stop}");
    const doc = diagramDoc(spec, counter());
    const b = itemOf(doc, "B");
    expect(isShapeNode(b) && [b.shape, b.label]).toEqual(["diamond", "Stop"]);
    expect(styleOf(doc.edges[0] ?? { id: "", fromNode: "", toNode: "" }).dash).toBe("solid");
  });
});

describe("reading mermaid stays linear", () => {
  test("a labelled link that never closes, then a long run of space, is read in time", () => {
    const started = performance.now();
    const text = `flowchart TD\nB\nA -- x${" ".repeat(50_000)}y`;
    expect(mermaidDiagram(text).reported).toEqual([
      expect.objectContaining({ line: 3, note: expect.stringContaining("could not read") }),
    ]);
    // Read by lazy splitting, this took seconds; read in place, a millisecond or two.
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("one cap on every diagram", () => {
  test("a spec past the boxes or links a diagram draws is refused, whichever text made it", () => {
    const many = Array.from({ length: DIAGRAM_LIMITS.boxes + 1 }, (_, i) => `N${i}`);
    expect(() => mermaidDiagram(`flowchart TD\n${many.join("\n")}`)).not.toThrow();
    expect(() =>
      diagramDoc(mermaidDiagram(`flowchart TD\n${many.join("\n")}`).spec, () => "x"),
    ).toThrow(`one draws ${DIAGRAM_LIMITS.boxes} at most`);
    const chain = many.slice(0, 30);
    const links = chain
      .flatMap((a) => chain.filter((b) => b !== a).map((b) => `${a} --> ${b}`))
      .slice(0, DIAGRAM_LIMITS.links + 1);
    expect(() =>
      diagramDoc(mermaidDiagram(`flowchart TD\n${links.join("\n")}`).spec, () => "x"),
    ).toThrow(`one draws ${DIAGRAM_LIMITS.links} at most`);
  });
});
