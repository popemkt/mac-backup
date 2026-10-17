/**
 * Trace, suggest and explainHop over the edge projection, as properties over
 * generated graphs plus the worked cases that pin their words. A walk is
 * over the nodes it is given; which nodes the graph shows is `visibleNodes`,
 * and a read over the visible nodes ranks paths the same on every host.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  adjacencyOf,
  explainHop,
  hopLabel,
  projectionOf,
  suggest,
  trace,
  traceOf,
  visibleNodes,
  type GraphProjection,
  type HopLabels,
  type LensEdge,
  type TraceHop,
} from "../src/index.ts";
import { node } from "./fixtures.ts";

const KINDS = ["mention", "child", "prop:field.influences"] as const;

/** A generated edge list over the ids n0…n{size-1}, with `sys.hub` among them when asked. */
const graphs = fc
  .record({
    size: fc.integer({ min: 2, max: 12 }),
    withSystem: fc.boolean(),
  })
  .chain(({ size, withSystem }) => {
    const ids = Array.from({ length: size }, (_, i) => `n${i}`).concat(
      withSystem ? ["sys.hub"] : [],
    );
    const id = fc.constantFrom(...ids);
    return fc.record({
      ids: fc.constant(ids),
      edges: fc
        .array(fc.record({ source: id, target: id, kind: fc.constantFrom(...KINDS) }), {
          maxLength: 30,
        })
        .map((raw) => dedupe(raw.filter((e) => e.source !== e.target))),
    });
  });

/** A projection over generated edges. */
function over(edges: readonly LensEdge[]): GraphProjection {
  return { edges, tags: new Map() };
}

function dedupe(raw: { source: string; target: string; kind: LensEdge["kind"] }[]): LensEdge[] {
  const seen = new Map<string, LensEdge>();
  for (const e of raw) seen.set(`${e.kind}:${e.source}->${e.target}`, { ...e, weight: 1 });
  return [...seen.values()];
}

/** The reference distance: plain BFS over the undirected view. */
function bfsDistance(edges: readonly LensEdge[], from: string, to: string): number | null {
  const adjacency = adjacencyOf(edges);
  const depth = new Map([[from, 0]]);
  const queue = [from];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    const d = depth.get(at) ?? 0;
    if (at === to) return d;
    for (const next of adjacency.get(at)?.keys() ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, d + 1);
      queue.push(next);
    }
  }
  return null;
}

const joins = (edges: readonly LensEdge[], step: TraceHop) =>
  edges.includes(step.edge) &&
  ((step.edge.source === step.from && step.edge.target === step.to) ||
    (step.edge.source === step.to && step.edge.target === step.from));

describe("trace", () => {
  test("every path is a simple path of the projection, cheapest first", () => {
    fc.assert(
      fc.property(graphs, ({ ids, edges }) => {
        const [from, to] = [ids[0] ?? "", ids[1] ?? ""];
        const { paths } = trace(over(edges), from, to, { k: 4, maxHops: 12 });
        for (const path of paths) {
          expect(path.nodes[0]).toBe(from);
          expect(path.nodes.at(-1)).toBe(to);
          expect(new Set(path.nodes).size).toBe(path.nodes.length);
          expect(path.hops.length).toBe(path.nodes.length - 1);
          for (const step of path.hops) expect(joins(edges, step)).toBe(true);
        }
        for (let i = 1; i < paths.length; i++) {
          const [a, b] = [paths[i - 1], paths[i]];
          if (a === undefined || b === undefined) continue;
          expect(
            a.hops.length < b.hops.length ||
              (a.hops.length === b.hops.length && a.hubCost <= b.hubCost + 1e-9),
          ).toBe(true);
        }
      }),
    );
  });

  test("the first path is as long as the BFS distance, and none is found exactly when there is none", () => {
    fc.assert(
      fc.property(graphs, ({ ids, edges }) => {
        const [from, to] = [ids[0] ?? "", ids[1] ?? ""];
        const result = trace(over(edges), from, to, { maxHops: 20 });
        const distance = bfsDistance(edges, from, to);
        if (distance === null) {
          expect(result.paths).toEqual([]);
          expect(result.reason?.code).toBe("unreached");
        } else {
          expect(result.paths[0]?.hops.length).toBe(distance);
          expect(result.reason).toBeNull();
        }
      }),
    );
  });

  test("a read over the visible nodes never routes through scaffolding, and asked, does", () => {
    const nodes = [
      node({ id: "a", text: "A", children: ["sys.hub"] }),
      node({ id: "sys.hub", text: "hub", children: ["b"] }),
      node({ id: "b", text: "B" }),
    ];
    const request = { from: "a", to: "b", kinds: ["child"] } as const;
    const shown = visibleNodes(nodes, { keeping: ["a", "b"] });
    expect(traceOf(shown, request).paths).toEqual([]);
    const whole = visibleNodes(nodes, { includeSystem: true });
    expect(traceOf(whole, request).paths[0]?.nodes).toEqual(["a", "sys.hub", "b"]);
  });

  test("a hub the graph elides costs nothing: degree is of the nodes the read is given", () => {
    // a—x—b and a—y—b, and x is also a sys.* node's child: elided, it makes x no hub.
    const nodes = [
      node({ id: "a", text: "A", children: ["x", "y"] }),
      node({ id: "x", text: "X", children: ["b"] }),
      node({ id: "y", text: "Y", children: ["b"] }),
      node({ id: "b", text: "B" }),
      node({ id: "sys.s", text: "s", children: ["x"] }),
    ];
    const request = { from: "a", to: "b", kinds: ["child"], k: 2 } as const;
    const server = traceOf(visibleNodes(nodes, { keeping: ["a", "b"] }), request);
    const page = traceOf(visibleNodes(nodes), request);
    expect(server).toEqual(page);
    expect(server.paths.map((path) => path.hubCost)).toEqual([Math.log(2), Math.log(2)]);
  });

  test("cycles terminate, and the paths stay simple", () => {
    const ring: LensEdge[] = ["a", "b", "c", "d", "e"].map((source, i, all) => ({
      source,
      target: all[(i + 1) % all.length] ?? "a",
      kind: "mention",
      weight: 1,
    }));
    const { paths } = trace(over(ring), "a", "c", { k: 10 });
    expect(paths.map((p) => p.nodes)).toEqual([
      ["a", "b", "c"],
      ["a", "e", "d", "c"],
    ]);
  });

  test("a tie in length goes to the path through the less connected node", () => {
    const edges: LensEdge[] = [
      { source: "a", target: "hub", kind: "mention", weight: 1 },
      { source: "hub", target: "b", kind: "mention", weight: 1 },
      { source: "a", target: "niche", kind: "mention", weight: 1 },
      { source: "niche", target: "b", kind: "mention", weight: 1 },
      ...["x", "y", "z"].map(
        (x): LensEdge => ({ source: x, target: "hub", kind: "mention", weight: 1 }),
      ),
    ];
    expect(trace(over(edges), "a", "b").paths.map((p) => p.nodes[1])).toEqual(["niche", "hub"]);
  });

  test("the visit cap warns and keeps what it found, and never fails", () => {
    fc.assert(
      fc.property(graphs, fc.integer({ min: 1, max: 6 }), ({ ids, edges }, cap) => {
        const result = trace(over(edges), ids[0] ?? "", ids[1] ?? "", { k: 5, visitCap: cap });
        const full = trace(over(edges), ids[0] ?? "", ids[1] ?? "", { k: 5 });
        if (result.warnings.length === 0) expect(result.paths).toEqual(full.paths);
        else expect(full.paths.slice(0, result.paths.length)).toEqual([...result.paths]);
        // Cut short before any path, the walk says so; it never claims there is none.
        if (result.paths.length === 0 && result.warnings.length > 0)
          expect(result.reason?.code).toBe("capped");
      }),
    );
  });

  test("a cap reached before any path says it was cut short, not that there is none", () => {
    const edges: LensEdge[] = [
      { source: "a", target: "m", kind: "mention", weight: 1 },
      { source: "m", target: "b", kind: "mention", weight: 1 },
    ];
    const result = trace(over(edges), "a", "b", { visitCap: 1 });
    expect(result.paths).toEqual([]);
    expect(result.reason?.code).toBe("capped");
  });

  test("one node at both ends is a reason, not a path", () => {
    expect(trace(over([]), "a", "a").reason?.code).toBe("same-node");
  });

  test("where several edges join a pair, the hop names the typed relation", () => {
    const edges: LensEdge[] = [
      { source: "a", target: "b", kind: "mention", weight: 1 },
      { source: "b", target: "a", kind: "child", weight: 1 },
      { source: "a", target: "b", kind: "prop:field.influences", weight: 1 },
    ];
    expect(trace(over(edges), "a", "b").paths[0]?.hops[0]?.edge.kind).toBe("prop:field.influences");
  });
});

function projection(edges: LensEdge[], tags: Record<string, string[]> = {}): GraphProjection {
  return { ...over(edges), tags: new Map(Object.entries(tags)) };
}

describe("suggest", () => {
  test("it never suggests a node the kinds already connect, nor the node itself", () => {
    fc.assert(
      fc.property(graphs, ({ ids, edges }) => {
        const id = ids[0] ?? "";
        const direct = new Set(adjacencyOf(edges).get(id)?.keys() ?? []);
        for (const s of suggest(projection(edges), id, { limit: 50 })) {
          expect(s.id).not.toBe(id);
          expect(direct.has(s.id)).toBe(false);
        }
      }),
    );
  });

  test("a candidate's score does not fall as shared neighbours are added", () => {
    fc.assert(
      fc.property(graphs, fc.integer({ min: 1, max: 4 }), ({ ids, edges }, extra) => {
        const [id, other] = [ids[0] ?? "", ids[1] ?? ""];
        if (adjacencyOf(edges).get(id)?.has(other) === true) return;
        const bridge = (z: string): LensEdge[] => [
          { source: z, target: id, kind: "mention", weight: 1 },
          { source: z, target: other, kind: "mention", weight: 1 },
        ];
        let before = 0;
        const grown = [...edges, ...bridge("z0")];
        for (let i = 1; i <= extra; i++) {
          const score =
            suggest(projection(grown), id, { limit: 100 }).find((s) => s.id === other)?.score ?? 0;
          expect(score).toBeGreaterThanOrEqual(before);
          before = score;
          grown.push(...bridge(`z${i}`));
        }
      }),
    );
  });

  test("the order is deterministic, whatever order the edges come in", () => {
    fc.assert(
      fc.property(graphs, ({ ids, edges }) => {
        const id = ids[0] ?? "";
        expect(suggest(projection(edges.toReversed()), id)).toEqual(suggest(projection(edges), id));
      }),
    );
  });

  test("each candidate carries its reasons: shared neighbours, shared tags, co-citation", () => {
    const edges: LensEdge[] = [
      { source: "z", target: "a", kind: "mention", weight: 1 },
      { source: "z", target: "b", kind: "mention", weight: 1 },
      { source: "a", target: "w", kind: "child", weight: 1 },
      { source: "c", target: "w", kind: "child", weight: 1 },
    ];
    const tagged = projection(edges, { a: ["t.rare"], b: ["t.rare"], c: [] });
    expect(suggest(tagged, "a")).toEqual([
      expect.objectContaining({
        id: "b",
        reasons: { shared: ["z"], tags: ["t.rare"], citedBy: ["z"] },
      }),
      expect.objectContaining({ id: "c", reasons: { shared: ["w"], tags: [], citedBy: [] } }),
    ]);
  });

  test("a tag node is scaffolding: no walk or suggestion over the visible nodes goes through it", () => {
    const nodes = [
      node({ id: "t", text: "t", props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] } }),
      node({ id: "a", text: "A", props: { "sys.f.type": [{ t: "ref", v: "t" }] } }),
      node({ id: "b", text: "B", props: { "sys.f.type": [{ t: "ref", v: "t" }] } }),
      node({
        id: "c",
        text: "C",
        props: { "sys.f.type": [{ t: "ref", v: "t" }] },
        children: ["a"],
      }),
      node({ id: "d", text: "D", children: ["c"] }),
    ];
    const kinds = new Set(["child", "ref-prop"] as const);
    const shown = projectionOf(visibleNodes(nodes, { keeping: ["a", "b"] }), kinds);
    const whole = projectionOf(nodes, kinds);
    expect(suggest(shown, "a").map((s) => s.id)).toEqual(["d"]);
    expect(suggest(whole, "a").map((s) => s.id)).toContain("b");
    expect(trace(whole, "a", "b").paths[0]?.nodes).toEqual(["a", "t", "b"]);
    expect(trace(shown, "a", "b").paths).toEqual([]);
  });

  test("the projection reads a node's tags apart from the kinds drawn", () => {
    const nodes = [
      node({
        id: "a",
        text: "A",
        props: {
          "sys.f.type": [
            { t: "ref", v: "t.todo" },
            { t: "ref", v: "sys.tag" },
          ],
        },
      }),
    ];
    expect(projectionOf(nodes, new Set(["mention"])).tags.get("a")).toEqual(["t.todo"]);
  });
});

function hop(from: string, to: string, edge: Omit<LensEdge, "weight">): TraceHop {
  return { from, to, edge: { ...edge, weight: 1 } };
}

describe("explainHop", () => {
  const labels: HopLabels = {
    textOf: (id) => id.toUpperCase(),
    relationOf: (field) =>
      field === "field.influences"
        ? { label: "influences", inverse: "influenced by" }
        : { label: "owner", inverse: null },
  };

  test("a built-in kind reads as a verb, either way round", () => {
    expect(explainHop(hop("a", "b", { source: "a", target: "b", kind: "mention" }), labels)).toBe(
      "A mentions B",
    );
    expect(explainHop(hop("b", "c", { source: "b", target: "c", kind: "child" }), labels)).toBe(
      "B contains C",
    );
    expect(explainHop(hop("c", "b", { source: "b", target: "c", kind: "child" }), labels)).toBe(
      "C is inside B",
    );
  });

  test("a typed relation reads as its field, and back by its inverse label", () => {
    const forward = hop("c", "d", { source: "c", target: "d", kind: "prop:field.influences" });
    expect(explainHop(forward, labels)).toBe("C —influences→ D");
    const back = hop("d", "e", { source: "e", target: "d", kind: "prop:field.influences" });
    expect(explainHop(back, labels)).toBe("E —influences→ D, read back as D ←influenced by— E");
    expect(hopLabel(back, labels)).toBe("influenced by");
    const noInverse = hop("d", "e", { source: "e", target: "d", kind: "prop:field.owner" });
    expect(hopLabel(noInverse, labels)).toBe("owner");
  });
});
