import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/protocol";
import { buildQueryDb } from "@/ds/db";
import {
  DEFAULT_MAX_NODES,
  extractLensGraph,
  type LensPerspective,
} from "@/lib/graph-lens";

const ISO = "2026-08-23T00:00:00.000Z";

function node(id: string, text: string, children: string[] = []): WireNode {
  return { id, text, props: {}, children, createdAt: ISO, updatedAt: ISO };
}

const PERSPECTIVE: LensPerspective = {
  id: "p",
  label: "p",
  query: "",
  renderer: "force2d",
  colorBy: "tag",
  sizeBy: "degree",
  edgeKinds: ["child"],
  maxNodes: DEFAULT_MAX_NODES,
  clusterBy: "none",
  focus: null,
};

/** a → b (both members), b → c (c outside the scope). */
function wire(): WireNode[] {
  return [
    node("n.a", "alpha", ["n.b"]),
    node("n.b", "beta", ["n.c"]),
    node("n.c", "gamma"),
  ];
}

describe("extractLensGraph — restrictTo (ontology scope)", () => {
  it("keeps only member nodes and their internal edges", () => {
    const nodes = wire();
    const db = buildQueryDb(nodes, 1);
    const graph = extractLensGraph(db, nodes, PERSPECTIVE, {
      restrictTo: new Set(["n.a", "n.b"]),
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["n.a", "n.b"]);
    expect(graph.edges).toEqual([
      { source: "n.a", target: "n.b", kind: "child" },
    ]);
  });

  it("drops edges with either endpoint outside the set", () => {
    const nodes = wire();
    const db = buildQueryDb(nodes, 1);
    const graph = extractLensGraph(db, nodes, PERSPECTIVE, {
      restrictTo: new Set(["n.b", "n.c"]),
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["n.b", "n.c"]);
    // a→b is gone (a is out); b→c survives (both in).
    expect(graph.edges).toEqual([
      { source: "n.b", target: "n.c", kind: "child" },
    ]);
  });

  it("renders nothing for an empty member set", () => {
    const nodes = wire();
    const db = buildQueryDb(nodes, 1);
    const graph = extractLensGraph(db, nodes, PERSPECTIVE, {
      restrictTo: new Set(),
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("composes with a perspective query (intersection, not replacement)", () => {
    const nodes = wire();
    const db = buildQueryDb(nodes, 1);
    const graph = extractLensGraph(
      db,
      nodes,
      {
        ...PERSPECTIVE,
        query: '[:find ?id :where [?n :node/text "beta"] [?n :node/id ?id]]',
      },
      { restrictTo: new Set(["n.a", "n.b"]) },
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["n.b"]);
  });

  it("is inert when restrictTo is omitted", () => {
    const nodes = wire();
    const db = buildQueryDb(nodes, 1);
    const graph = extractLensGraph(db, nodes, PERSPECTIVE, {});
    expect(graph.nodes.map((n) => n.id)).toEqual(["n.a", "n.b", "n.c"]);
    expect(graph.edges).toHaveLength(2);
  });
});
