import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { DatascriptIndex, queryBacklinks } from "@/ds";
import { fixtureGraph } from "@/fixtures/graph";
import type { WireNode } from "@kb/contracts";

describe("queryBacklinks", () => {
  let nodes: WireNode[];

  beforeEach(() => {
    nodes = structuredClone(fixtureGraph.nodes);
    const a = present(
      nodes.find((n) => n.id === "n.root-b"),
      "n.root-b",
    );
    a.text = `See [[n.root-a|Ship]] for context`;
  });

  it("finds nodes that mention the target via :node/mentions", () => {
    const db = new DatascriptIndex(nodes);
    const hits = queryBacklinks(db, "n.root-a");
    expect(hits.map((h) => h.id)).toContain("n.root-b");
  });
});
