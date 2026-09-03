/**
 * W4 result-row render. Query-node results render as read-only ref rows:
 * dashed bullet ring, ⌕ glyph on the query node itself, expand affordance
 * without children. Rendered via react-dom/server off pure props (store
 * hooks resolve zustand's initial state inside React's server renderer, so
 * store-coupled components are covered by the logic tests in
 * lib/query-node.test.ts + instance-identity.component.test.tsx).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runQuery } from "@/ds/query";
import { buildQueryDb } from "@/ds/db";
import { fixtureGraph } from "@/fixtures/graph";
import { resultNodeIds } from "@/lib/query-node";
import { wireToOutlineMap } from "@/lib/graph-view";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import type { WireNode } from "@kb/contracts";
import { Bullet } from "./bullet";

const TODO_EDN = `[:find ?id ?text
  :where [?n :f/${SYSTEM_IDS.typeField} ?t]
         [?t :node/id "tag.todo"]
         [?n :node/id ?id]
         [?n :node/text ?text]]`;

function queryWire(): WireNode {
  return {
    id: "n.q1",
    text: "Open todos",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.queryTag }],
      [SYSTEM_IDS.queryField]: [{ t: "str", v: TODO_EDN }],
    },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

function outlineMap(): Map<string, OutlineNode> {
  return wireToOutlineMap([...fixtureGraph.nodes, queryWire()], new Set());
}

function renderBullet(node: OutlineNode, isRef: boolean): string {
  return renderToStaticMarkup(
    createElement(Bullet, { node, isRef, onClick: () => {} }),
  );
}

describe("result row render (W4)", () => {
  it("query rows resolve to real nodes and render dashed ref bullets", () => {
    const nodes = outlineMap();
    const db = buildQueryDb([...fixtureGraph.nodes, queryWire()], 1);
    const rows = runQuery(db, TODO_EDN);
    const ids = resultNodeIds(rows, nodes, { excludeId: "n.q1" });
    expect(ids.sort()).toEqual(["n.root-a", "n.root-b"]);

    for (const id of ids) {
      const html = renderBullet(nodes.get(id)!, true);
      // dashed reference ring marks a result row
      expect(html).toContain('data-bullet-ref="true"');
      expect(html).toContain("data-bullet-ref-ring");
      expect(html).toContain("border-dashed");
    }

    // Same node rendered as a normal outline row has no ref ring.
    const plain = renderBullet(nodes.get("n.root-b")!, false);
    expect(plain).not.toContain("data-bullet-ref");
    expect(plain).not.toContain("data-bullet-ref-ring");
  });

  it("query node bullet renders the ⌕ kind with an expand affordance", () => {
    const nodes = outlineMap();
    const q = nodes.get("n.q1")!;
    expect(q.collapsed).toBe(true); // cheap-by-default
    expect(q.children).toEqual([]);

    const html = renderBullet(q, false);
    expect(html).toContain('data-bullet-kind="query"');
    expect(html).toContain("data-bullet-query");
    // collapsed query node shows the halo even without children
    expect(html).toContain("data-bullet-halo");
    expect(html).toContain("Expand results");

    const expanded = renderBullet({ ...q, collapsed: false }, false);
    expect(expanded).not.toContain("data-bullet-halo");
  });

  it("sys.query.* saved-query rows render as dimmed sys query bullets", () => {
    const saved: WireNode = {
      ...queryWire(),
      id: "sys.query.open-todos",
      text: "open-todos",
    };
    const nodes = wireToOutlineMap(
      [...fixtureGraph.nodes, saved],
      new Set(),
    );
    const html = renderBullet(nodes.get("sys.query.open-todos")!, false);
    expect(html).toContain('data-bullet-kind="query"');
    expect(html).toContain('data-bullet-sys="true"');
  });

  it("isRef applies only to the top-level result row (children stay ordinary)", () => {
    // Render assertion: parent ref bullet vs child ordinary bullet.
    // Full NodeBlock cascade covered in instance-identity.component.test.tsx.
    const nodes = outlineMap();
    const top = renderBullet(nodes.get("n.root-a")!, true);
    expect(top).toContain('data-bullet-ref="true"');
    const child = renderBullet(nodes.get("n.child-a1")!, false);
    expect(child).not.toContain("data-bullet-ref");
  });
});
