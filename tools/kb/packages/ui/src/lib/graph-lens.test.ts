import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { buildQueryDb } from "@/ds/db";
import {
  DEFAULT_EDGE_KINDS,
  DEFAULT_MAX_NODES,
  buildTreeForest,
  extractLensGraph,
  firstTagOf,
  idsFromQueryRows,
  listPerspectiveNodes,
  parsePerspective,
  resolveClusterKey,
  resolveColor,
  resolveSize,
  buildParentMap,
  type LensPerspective,
} from "@/lib/graph-lens";
import { SYSTEM_IDS } from "@/lib/types";

const ISO = "2026-08-08T05:00:00.000Z";

function node(
  partial: Pick<WireNode, "id" | "text"> & Partial<Omit<WireNode, "id" | "text">>,
): WireNode {
  return {
    props: {},
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...partial,
  };
}

function baseGraph(): WireNode[] {
  return [
    node({ id: "sys.field", text: "sys.field" }),
    node({ id: "sys.tag", text: "sys.tag" }),
    node({
      id: "sys.f.type",
      text: "type",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: SYSTEM_IDS.graphPerspectiveTag,
      text: "graph-perspective",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag" }],
      },
    }),
    node({
      id: "tag.todo",
      text: "todo",
      props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] },
    }),
    node({
      id: "tag.note",
      text: "note",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag" }],
        "sys.f.color": [{ t: "str", v: "#ff00aa" }],
      },
    }),
    node({
      id: "n.a",
      text: "Alpha mentions [[n.b|Beta]]",
      props: { "sys.f.type": [{ t: "ref", v: "tag.todo" }] },
      children: ["n.a1"],
    }),
    node({
      id: "n.a1",
      text: "Child of alpha",
      props: { "sys.f.type": [{ t: "ref", v: "tag.note" }] },
    }),
    node({
      id: "n.b",
      text: "Beta",
      props: {
        "sys.f.type": [{ t: "ref", v: "tag.todo" }],
        "field.depends": [{ t: "ref", v: "n.c" }],
      },
    }),
    node({
      id: "n.c",
      text: "Gamma orphan",
    }),
    node({
      id: SYSTEM_IDS.lensAllMentions,
      text: "All mentions",
      props: {
        "sys.f.type": [{ t: "ref", v: SYSTEM_IDS.graphPerspectiveTag }],
        [SYSTEM_IDS.lensRendererField]: [{ t: "str", v: "force2d" }],
        [SYSTEM_IDS.lensEdgeKindsField]: [
          { t: "str", v: "mention" },
          { t: "str", v: "child" },
        ],
      },
    }),
  ];
}

function perspective(patch: Partial<LensPerspective> = {}): LensPerspective {
  return {
    id: SYSTEM_IDS.lensAllMentions,
    label: "All mentions",
    query: "",
    renderer: "force2d",
    colorBy: "tag",
    sizeBy: "degree",
    edgeKinds: [...DEFAULT_EDGE_KINDS],
    maxNodes: DEFAULT_MAX_NODES,
    clusterBy: "none",
    focus: null,
    layout: "force",
    spread: 150,
    linkDistance: 60,
    showLabels: true,
    curvedLinks: false,
    autorotate: false,
    labelDensity: "medium",
    ...patch,
  };
}

describe("parsePerspective / listPerspectiveNodes", () => {
  it("lists #graph-perspective nodes and applies defaults", () => {
    const nodes = baseGraph();
    const listed = listPerspectiveNodes(nodes);
    expect(listed.map((n) => n.id)).toEqual([SYSTEM_IDS.lensAllMentions]);
    const p = parsePerspective(listed[0]!);
    expect(p.renderer).toBe("force2d");
    expect(p.edgeKinds).toEqual(["mention", "child"]);
    expect(p.colorBy).toBe("tag");
    expect(p.sizeBy).toBe("degree");
    expect(p.maxNodes).toBe(500);
    expect(p.query).toBe("");
    expect(p.clusterBy).toBe("parent");
    expect(p.layout).toBe("force");
  });
});

describe("extractLensGraph", () => {
  let nodes: WireNode[];

  beforeEach(() => {
    nodes = baseGraph();
  });

  it("includes mention + child edges by default", () => {
    const db = buildQueryDb(nodes, 1);
    const g = extractLensGraph(db, nodes, perspective());
    const kinds = new Set(g.edges.map((e) => e.kind));
    expect(kinds.has("mention")).toBe(true);
    expect(kinds.has("child")).toBe(true);
    expect(kinds.has("ref-prop")).toBe(false);
    expect(g.edges).toContainEqual({
      source: "n.a",
      target: "n.b",
      kind: "mention",
      weight: 1,
    });
    expect(g.edges).toContainEqual({
      source: "n.a",
      target: "n.a1",
      kind: "child",
      weight: 1,
    });
  });

  it("smart-elides sys/command/schema by default; toggle re-includes", () => {
    const db = buildQueryDb(nodes, 1);
    const elided = extractLensGraph(db, nodes, perspective());
    const elidedIds = new Set(elided.nodes.map((n) => n.id));
    expect(elidedIds.has("sys.field")).toBe(false);
    expect(elidedIds.has("sys.f.type")).toBe(false);
    expect(elidedIds.has("tag.todo")).toBe(false);
    expect(elidedIds.has("n.a")).toBe(true);
    expect(elidedIds.has("n.b")).toBe(true);

    const full = extractLensGraph(db, nodes, perspective(), {
      includeSystemNodes: true,
    });
    const fullIds = new Set(full.nodes.map((n) => n.id));
    expect(fullIds.has("sys.field")).toBe(true);
    expect(fullIds.has("tag.todo")).toBe(true);
    expect(full.nodes.length).toBeGreaterThan(elided.nodes.length);
  });

  it("selects only ref-prop edges when configured", () => {
    const db = buildQueryDb(nodes, 1);
    const g = extractLensGraph(db, nodes, perspective({ edgeKinds: ["ref-prop"] }));
    expect(g.edges.every((e) => e.kind === "ref-prop")).toBe(true);
    expect(g.edges).toContainEqual({
      source: "n.b",
      target: "n.c",
      kind: "ref-prop",
      weight: 1,
    });
  });

  it("filters nodes by lens.query EDN", () => {
    const db = buildQueryDb(nodes, 1);
    const g = extractLensGraph(
      db,
      nodes,
      perspective({
        query:
          '[:find ?id :where [?n :node/id ?id] [?n :f/sys.f.type ?t] [?t :node/id "tag.todo"]]',
        edgeKinds: ["mention"],
      }),
    );
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has("n.a")).toBe(true);
    expect(ids.has("n.b")).toBe(true);
    expect(ids.has("n.a1")).toBe(false);
    expect(ids.has("n.c")).toBe(false);
  });

  it("bad EDN query yields empty set and warns (never all-nodes)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = buildQueryDb(nodes, 1);
    const g = extractLensGraph(
      db,
      nodes,
      perspective({
        query: "[:find ?id :where this-is-not-valid-edn",
        edgeKinds: ["mention"],
      }),
    );
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("caps to highest-degree nodes and logs dropped count", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = buildQueryDb(nodes, 1);
    const g = extractLensGraph(
      db,
      nodes,
      perspective({ maxNodes: 3, edgeKinds: ["mention", "child", "ref-prop"] }),
    );
    expect(g.nodes.length).toBe(3);
    expect(g.dropped).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resolves color-by tag and fixed", () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const tagged = resolveColor(
      nodes.find((n) => n.id === "n.a1")!,
      byId,
      "tag",
    );
    expect(tagged).toBe("#ff00aa");
    const fixed = resolveColor(
      nodes.find((n) => n.id === "n.c")!,
      byId,
      "fixed:#abcdef",
    );
    expect(fixed).toBe("#abcdef");
    expect(
      firstTagOf(
        nodes.find((n) => n.id === "n.a")!,
        byId,
      )?.id,
    ).toBe("tag.todo");
  });

  it("resolveClusterKey covers none / parent / tag / prop", () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const parentOf = buildParentMap(nodes);
    const a = nodes.find((n) => n.id === "n.a")!;
    const a1 = nodes.find((n) => n.id === "n.a1")!;
    const b = nodes.find((n) => n.id === "n.b")!;
    expect(resolveClusterKey(a, byId, parentOf, "none")).toBe("none");
    expect(resolveClusterKey(a1, byId, parentOf, "parent")).toBe("n.a");
    expect(resolveClusterKey(a, byId, parentOf, "parent")).toBe("root");
    expect(resolveClusterKey(a, byId, parentOf, "tag:tag.todo")).toBe("tag.todo");
    expect(resolveClusterKey(a1, byId, parentOf, "tag:tag.todo")).toBe("untagged");
    expect(resolveClusterKey(b, byId, parentOf, "prop:field.depends")).toBe("n.c");
    expect(resolveClusterKey(a, byId, parentOf, "prop:field.depends")).toBe("none");
  });

  it("buildTreeForest: forest roots vs focus root, cycle-safe", () => {
    const db = buildQueryDb(nodes, 1);
    const g = extractLensGraph(db, nodes, perspective({ edgeKinds: ["child"] }));
    const forest = buildTreeForest(nodes, g.nodes, null);
    const rootIds = forest.map((t) => t.id).toSorted();
    expect(rootIds).toContain("n.a");
    expect(rootIds).not.toContain("n.a1");
    const focused = buildTreeForest(nodes, g.nodes, "n.a");
    expect(focused).toHaveLength(1);
    expect(focused[0]!.id).toBe("n.a");
    expect(focused[0]!.children.some((c) => c.id === "n.a1")).toBe(true);

    // Cycle: a → a1 → a
    const cyclic = nodes.map((n) => (n.id === "n.a1" ? { ...n, children: ["n.a"] } : { ...n }));
    const g2 = extractLensGraph(
      buildQueryDb(cyclic, 1),
      cyclic,
      perspective({ edgeKinds: ["child"] }),
    );
    expect(() => buildTreeForest(cyclic, g2.nodes, "n.a")).not.toThrow();
    const cyc = buildTreeForest(cyclic, g2.nodes, "n.a");
    expect(cyc[0]!.id).toBe("n.a");
  });

  it("resolves size-by degree / children / fixed", () => {
    expect(resolveSize("fixed", 10, 10)).toBe(5);
    expect(resolveSize("children", 0, 0)).toBe(3);
    expect(resolveSize("children", 0, 16)).toBeGreaterThan(resolveSize("children", 0, 1));
    expect(resolveSize("degree", 16, 0)).toBeGreaterThan(resolveSize("degree", 1, 0));
  });

  it("idsFromQueryRows picks known string ids", () => {
    const known = new Set(["n.a", "n.b"]);
    const ids = idsFromQueryRows([["n.a", "Alpha"], [1, "n.b"], ["missing"]], known);
    expect([...ids].toSorted()).toEqual(["n.a", "n.b"]);
  });
});
