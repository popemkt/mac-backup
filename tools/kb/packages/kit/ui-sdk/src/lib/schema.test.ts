import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { withExpansion, wireToOutlineMap } from "./graph-view";
import { schemaOf, schemaOfGraph } from "./schema";
import { SYSTEM_IDS } from "./types";

const ISO = "2026-10-16T00:00:00.000Z";

function wire(id: string, children: string[] = [], props: WireNode["props"] = {}): WireNode {
  return { id, text: id, props, children, createdAt: ISO, updatedAt: ISO };
}

/**
 * Every reason a row defaults to collapsed, and a row of each kind that does
 * not: children, a visible field value, a query definition; a leaf, a row
 * whose only value is in a hidden field, and the field nodes themselves.
 */
const snapshot = (): WireNode[] => [
  wire("f.status", [], { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] }),
  wire("f.secret", [], {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
    [SYSTEM_IDS.hiddenField]: [{ t: "bool", v: true }],
  }),
  wire("n.a", ["n.a1", "n.a2"]),
  wire("n.a1"),
  wire("n.a2", ["n.a21"]),
  wire("n.a21"),
  wire("n.fields", [], { "f.status": [{ t: "str", v: "doing" }] }),
  wire("n.hidden", [], { "f.secret": [{ t: "str", v: "shh" }] }),
  wire("n.query", [], { [SYSTEM_IDS.queryField]: [{ t: "str", v: "[:find ?id]" }] }),
  wire("n.b"),
];

const ALL = snapshot().map((n) => n.id);

/** `ids` as the reader's choice to open each of them. */
const opened = (ids: readonly string[]) => new Map(ids.map((id) => [id, true] as const));

describe("withExpansion", () => {
  it("is the whole-graph projection of the snapshot, for any set of opened rows", () => {
    const wireNodes = snapshot();
    const cases: string[][] = [
      [],
      ["n.a"],
      ["n.fields", "n.query"],
      ["n.a", "n.a2", "n.b", "n.hidden"],
      ALL,
    ];
    for (const ids of cases) {
      const view = withExpansion(schemaOf({ wireNodes }), opened(ids));
      expect([...view.entries()]).toEqual([
        ...wireToOutlineMap(wireNodes, new Set(ids), wireNodes).entries(),
      ]);
    }
  });

  it("defaults: children, visible fields and a query collapse; a hidden value does not", () => {
    const view = withExpansion(schemaOf({ wireNodes: snapshot() }), new Map());
    expect(view.get("n.a")?.collapsed).toBe(true);
    expect(view.get("n.fields")?.collapsed).toBe(true);
    expect(view.get("n.query")?.collapsed).toBe(true);
    expect(view.get("n.hidden")?.collapsed).toBe(false);
    expect(view.get("n.b")?.collapsed).toBe(false);
  });

  it("builds no map: with no choice it is the schema, and a view reads the schema's rows", () => {
    const schema = schemaOf({ wireNodes: snapshot() });
    expect(withExpansion(schema, new Map())).toBe(schema);
    const view = withExpansion(schema, opened(["n.a"]));
    expect(view).not.toBeInstanceOf(Map);
    expect(view.size).toBe(schema.size);
    // A row shown as its default is the schema's own object.
    expect(view.get("n.b")).toBe(schema.get("n.b"));
    expect(view.get("n.a")).not.toBe(schema.get("n.a"));
  });

  it("closes a row the reader closed, even one that defaults to open", () => {
    const schema = schemaOf({ wireNodes: snapshot() });
    const view = withExpansion(schema, new Map([["n.hidden", false] as const]));
    expect(view.get("n.hidden")?.collapsed).toBe(true);
  });

  it("keeps the object of every row that shows as it did, across snapshots and views", () => {
    const first = snapshot();
    const before = withExpansion(schemaOf({ wireNodes: first }), opened(["n.a"]));
    const next = first.map((n) => (n.id === "n.b" ? { ...n, text: "renamed" } : n));
    const after = withExpansion(schemaOf({ wireNodes: next }), opened(["n.a", "n.a2"]));
    expect(after.get("n.a")).toBe(before.get("n.a"));
    expect(after.get("n.a1")).toBe(before.get("n.a1"));
    expect(after.get("n.a2")).not.toBe(before.get("n.a2"));
    expect(after.get("n.a2")?.collapsed).toBe(false);
    expect(after.get("n.b")?.text).toBe("renamed");
  });
});

describe("schemaOf", () => {
  it("a lookup changes nothing: a node's object does not depend on which snapshot was asked last", () => {
    const a = snapshot();
    const b = a.map((n) => (n.id === "n.b" ? { ...n, text: "b2" } : n));
    const c = b.map((n) => (n.id === "n.a1" ? { ...n, text: "a1-2" } : n));
    const sa = schemaOf({ wireNodes: a });
    const sb = schemaOf({ wireNodes: b });
    // Ask for the older snapshot again: a lookup, not a build.
    expect(schemaOf({ wireNodes: a })).toBe(sa);
    const sc = schemaOf({ wireNodes: c });
    expect(sc.get("n.a21")).toBe(sa.get("n.a21"));
    expect(sc.get("n.a21")).toBe(sb.get("n.a21"));
    expect(sc.get("n.b")).toBe(sb.get("n.b"));
    expect(sc.get("n.a1")).not.toBe(sb.get("n.a1"));
  });
});

describe("schemaOf identity follows content", () => {
  it("a, then b, then a again: back at a's content, every node is a's object again", () => {
    const a = snapshot();
    const sa = schemaOf({ wireNodes: a });
    const b = a.map((n) => (n.id === "n.b" ? { ...n, text: "b2" } : n));
    const sb = schemaOf({ wireNodes: b });
    expect(sb.get("n.b")).not.toBe(sa.get("n.b"));
    // A new snapshot with a's content: built, not looked up.
    const again = schemaOf({ wireNodes: a.map((n) => ({ ...n })) });
    expect(again).not.toBe(sa);
    for (const [id, node] of sa) expect(again.get(id)).toBe(node);
  });
});

describe("schemaOfGraph", () => {
  it("takes a projection of the whole graph, however its wire array was handed over", () => {
    const wireNodes = snapshot();
    expect(schemaOfGraph(wireToOutlineMap(wireNodes, new Set())).get("n.a21")).toBeDefined();
    const copy = wireToOutlineMap([...wireNodes], new Set(), wireNodes);
    expect(schemaOfGraph(copy).get("n.a21")).toBeDefined();
  });

  it("refuses a projection of part of the graph", () => {
    const wireNodes = snapshot();
    const scoped = wireToOutlineMap(
      wireNodes.filter((n) => n.id !== "n.b"),
      new Set(),
      wireNodes,
    );
    expect(() => schemaOfGraph(scoped)).toThrow(/scoped projection/);
  });
});
