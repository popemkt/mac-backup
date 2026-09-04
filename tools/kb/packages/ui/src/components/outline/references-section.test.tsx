/**
 * W8a inline References: backlinks render at the bottom of a zoomed view as
 * read-only ref rows (replaces the deleted NODE panel). The store-coupled
 * half resolves backlinks via ds/db queryBacklinks (tested there + here on
 * fixture data); the view half renders off pure props like the other
 * server-rendered row tests.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WireNode } from "@kb/contracts";
import { buildQueryDb, queryBacklinks } from "@/ds/db";
import { fixtureGraph } from "@/fixtures/graph";
import { ReferencesView } from "./references-section";

function referrer(): WireNode {
  return {
    id: "n.referrer",
    text: "See [[n.root-a|Ship kb ui shell]] for context",
    props: {},
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("inline References (W8a)", () => {
  it("queryBacklinks resolves [[ref]] mentions from node text", () => {
    const db = buildQueryDb([...fixtureGraph.nodes, referrer()], 1);
    expect(queryBacklinks(db, "n.root-a").map((b) => b.id)).toEqual(["n.referrer"]);
    expect(queryBacklinks(db, "n.root-b")).toEqual([]);
  });

  it("renders a References header + one ref row per backlink", () => {
    const html = renderToStaticMarkup(
      createElement(ReferencesView, {
        nodeId: "n.root-a",
        backlinks: [
          { id: "n.referrer", text: "See root-a", tags: [] },
          { id: "n.other", text: "Other link", tags: [] },
        ],
      }),
    );
    expect(html).toContain("References (2)");
    expect(html).toContain('data-references-for="n.root-a"');
    expect(html).toContain('data-node-id="n.referrer"');
  });

  it("renders nothing when the node has no backlinks", () => {
    const html = renderToStaticMarkup(
      createElement(ReferencesView, { nodeId: "n.root-b", backlinks: [] }),
    );
    expect(html).toBe("");
  });
});
