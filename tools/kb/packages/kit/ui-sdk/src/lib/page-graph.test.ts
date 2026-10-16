import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import { wireToOutlineMap } from "./graph-view";
import { scopedWireNodes } from "./page-graph";

const ISO = "2026-08-23T00:00:00.000Z";

function node(id: string, children: string[] = []): WireNode {
  return { id, text: id, props: {}, children, createdAt: ISO, updatedAt: ISO };
}

/**
 *   n.a  ─ children: [n.b (member), n.x (NOT a member)]
 *   n.b
 *   n.x
 *   o.1, o.2  the ontologies a scope hangs its members off
 */
function graph(): WireNode[] {
  return [node("n.a", ["n.b", "n.x"]), node("n.b"), node("n.x"), node("o.1"), node("o.2")];
}

describe("scopedWireNodes", () => {
  it("drops non-members and strips non-member children", () => {
    const scoped = scopedWireNodes(graph(), new Set(["n.a", "n.b"]), "o.1");
    expect(scoped.map((n) => n.id).toSorted()).toEqual(["n.a", "n.b", "o.1"]);
    expect(
      present(
        scoped.find((n) => n.id === "n.a"),
        "n.a scoped",
      ).children,
    ).toEqual(["n.b"]);
  });

  it("leaves no dangling child ids in the outline map", () => {
    const scoped = scopedWireNodes(graph(), new Set(["n.a", "n.b"]), "o.1");
    const map = wireToOutlineMap(scoped, new Set(["n.a", "o.1"]));
    for (const n of map.values()) {
      for (const child of n.children) {
        expect(map.has(child)).toBe(true);
      }
    }
  });

  it("hangs top-level members off the ontology so the scope has one root", () => {
    const scoped = scopedWireNodes(graph(), new Set(["n.a", "n.b"]), "o.1");
    // n.b is nested under n.a, so only n.a hangs off the scope root.
    const first = present(scoped.at(0), "first scoped");
    expect(first.id).toBe("o.1");
    expect(first.children).toEqual(["n.a"]);
  });

  it("never emits the ontology node as its own member", () => {
    const scoped = scopedWireNodes(graph(), new Set(["o.1", "n.b"]), "o.1");
    expect(scoped.filter((n) => n.id === "o.1")).toHaveLength(1);
    const first = present(scoped.at(0), "first scoped");
    expect(first.children).toEqual(["n.b"]);
  });

  it("returns nothing but the root for an empty member set", () => {
    const scoped = scopedWireNodes(graph(), new Set(), "o.2");
    expect(scoped.map((n) => n.id)).toEqual(["o.2"]);
    const first = present(scoped.at(0), "first scoped");
    expect(first.children).toEqual([]);
  });

  it("omits the root entirely when the ontology node is gone", () => {
    const scoped = scopedWireNodes(graph(), new Set(["n.b"]), "o.missing");
    expect(scoped.map((n) => n.id)).toEqual(["n.b"]);
  });
});
