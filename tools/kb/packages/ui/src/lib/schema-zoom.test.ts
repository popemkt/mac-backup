import { describe, expect, it } from "vitest";
import { buildQueryDb } from "@/ds/db";
import { fixtureGraph } from "@/fixtures/graph";
import {
  queryFieldCarriers,
  queryTaggedInstances,
  schemaZoomKind,
} from "@/lib/schema-zoom";
import { wireToOutlineMap } from "@/lib/graph-view";

describe("schema zoom queries", () => {
  const qdb = buildQueryDb(fixtureGraph.nodes, fixtureGraph.rev);
  const nodes = wireToOutlineMap(fixtureGraph.nodes, new Set());

  it("detects tag vs field zoom kinds", () => {
    expect(schemaZoomKind(nodes.get("tag.todo"))).toBe("tag");
    expect(schemaZoomKind(nodes.get("field.status"))).toBe("field");
    expect(schemaZoomKind(nodes.get("n.root-a"))).toBeNull();
  });

  it("lists everything tagged with a tag node", () => {
    const hits = queryTaggedInstances(qdb, "tag.todo");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("n.root-a");
    expect(ids).toContain("n.root-b");
    expect(ids).not.toContain("tag.todo");
    expect(ids).not.toContain("n.root-c");
  });

  it("lists nodes carrying a field", () => {
    const hits = queryFieldCarriers(qdb, "field.status");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("n.root-a");
    expect(ids).toContain("n.root-b");
    expect(ids).not.toContain("n.root-c");
  });
});
