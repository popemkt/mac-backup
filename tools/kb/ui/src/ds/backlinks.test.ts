import { beforeEach, describe, expect, it } from "vitest";
import { buildQueryDb, queryBacklinks } from "@/ds/db";
import { fixtureGraph } from "@/fixtures/graph";
import type { WireNode } from "@kb/protocol";

describe("queryBacklinks", () => {
  let nodes: WireNode[];

  beforeEach(() => {
    nodes = structuredClone(fixtureGraph.nodes);
    const a = nodes.find((n) => n.id === "n.root-b")!;
    a.text = `See [[n.root-a|Ship]] for context`;
  });

  it("finds nodes that mention the target via :node/mentions", () => {
    const db = buildQueryDb(nodes, 1);
    const hits = queryBacklinks(db, "n.root-a");
    expect(hits.map((h) => h.id)).toContain("n.root-b");
  });
});
