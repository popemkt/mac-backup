import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { buildQueryDb } from "@/ds/db";
import {
  excludedRows,
  listOntologyItems,
  memberRows,
  resolveScope,
  scopedWireNodes,
} from "@/lib/ontology-scope";
import { wireToOutlineMap } from "@/lib/graph-view";
import { SYSTEM_IDS } from "@/lib/types";

const ISO = "2026-08-23T00:00:00.000Z";

function node(
  id: string,
  text: string,
  props: WireNode["props"] = {},
  children: string[] = [],
): WireNode {
  return { id, text, props, children, createdAt: ISO, updatedAt: ISO };
}

function tagDef(id: string, text: string): WireNode {
  return node(id, text, {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
  });
}

function tagged(id: string, text: string, tagId: string, children: string[] = []): WireNode {
  return node(id, text, { [SYSTEM_IDS.typeField]: [{ t: "ref", v: tagId }] }, children);
}

function onto(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return node(id, text, {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
    ...props,
  });
}

/**
 *   t.svc (tag)
 *   n.a  #svc  ─ children: [n.b (member), n.x (NOT a member)]
 *   n.b  #svc
 *   n.x  (untagged)
 */
function graph(): WireNode[] {
  return [
    tagDef("t.svc", "service"),
    tagged("n.a", "alpha", "t.svc", ["n.b", "n.x"]),
    tagged("n.b", "beta", "t.svc"),
    node("n.x", "outsider"),
    onto("o.1", "Services", {
      [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: "t.svc" }],
    }),
    onto("o.2", "Empty"),
  ];
}

describe("scopedWireNodes", () => {
  it("drops non-members and strips non-member children", () => {
    const wire = graph();
    const scoped = scopedWireNodes(wire, new Set(["n.a", "n.b"]), "o.1");
    const ids = scoped.map((n) => n.id).toSorted();
    expect(ids).toEqual(["n.a", "n.b", "o.1"]);
    expect(scoped.find((n) => n.id === "n.a")!.children).toEqual(["n.b"]);
  });

  it("leaves no dangling child ids in the outline map", () => {
    const wire = graph();
    const scoped = scopedWireNodes(wire, new Set(["n.a", "n.b"]), "o.1");
    const map = wireToOutlineMap(scoped, new Set(["n.a", "o.1"]));
    for (const n of map.values()) {
      for (const child of n.children) {
        expect(map.has(child)).toBe(true);
      }
    }
  });

  it("hangs top-level members off the ontology so the scope has one root", () => {
    const wire = graph();
    const scoped = scopedWireNodes(wire, new Set(["n.a", "n.b"]), "o.1");
    // n.b is nested under n.a, so only n.a hangs off the scope root.
    expect(scoped[0]!.id).toBe("o.1");
    expect(scoped[0]!.children).toEqual(["n.a"]);
  });

  it("never emits the ontology node as its own member", () => {
    const scoped = scopedWireNodes(graph(), new Set(["o.1", "n.b"]), "o.1");
    expect(scoped.filter((n) => n.id === "o.1")).toHaveLength(1);
    expect(scoped[0]!.children).toEqual(["n.b"]);
  });

  it("returns nothing but the root for an empty member set", () => {
    const scoped = scopedWireNodes(graph(), new Set(), "o.2");
    expect(scoped.map((n) => n.id)).toEqual(["o.2"]);
    expect(scoped[0]!.children).toEqual([]);
  });

  it("omits the root entirely when the ontology node is gone", () => {
    const scoped = scopedWireNodes(graph(), new Set(["n.b"]), "o.missing");
    expect(scoped.map((n) => n.id)).toEqual(["n.b"]);
  });
});

describe("resolveScope", () => {
  it("resolves membership through the shared resolver", () => {
    const wire = graph();
    const r = resolveScope(wire, "o.1", buildQueryDb(wire, 1), 1);
    expect([...r.members].toSorted()).toEqual(["n.a", "n.b"]);
    expect(r.warnings).toEqual([]);
  });

  it("memoizes per snapshot identity, not per rev", () => {
    const wire = graph();
    const db = buildQueryDb(wire, 1);
    const a = resolveScope(wire, "o.1", db, 1);
    expect(resolveScope(wire, "o.1", db, 1)).toBe(a);
    // Same rev but a NEW snapshot (an optimistic local edit) must re-resolve:
    // rev does not move for local edits, so it cannot be the cache key.
    const edited = [
      ...wire.filter((n) => n.id !== "o.1"),
      onto("o.1", "Services", {
        [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: "t.svc" }],
        [SYSTEM_IDS.ontoExcludeField]: [{ t: "ref", v: "n.b" }],
      }),
    ];
    const b = resolveScope(edited, "o.1", buildQueryDb(edited, 1), 1);
    expect(b).not.toBe(a);
    expect([...b.members]).toEqual(["n.a"]);
    // A new rev on the same array also re-resolves.
    expect(resolveScope(wire, "o.1", db, 2)).not.toBe(a);
  });

  it("runs a parameter-free onto.query through the client datalog engine", () => {
    const wire = [
      ...graph(),
      onto("o.q", "Query-defined", {
        [SYSTEM_IDS.ontoQueryField]: [
          {
            t: "str",
            v: '[:find ?id :where [?n :node/text "outsider"] [?n :node/id ?id]]',
          },
        ],
      }),
    ];
    const r = resolveScope(wire, "o.q", buildQueryDb(wire, 1), 1);
    expect([...r.members]).toEqual(["n.x"]);
    expect(r.warnings).toEqual([]);
  });

  it("surfaces malformed EDN as a warning, not a throw", () => {
    const wire = [
      ...graph(),
      onto("o.bad", "Broken", {
        [SYSTEM_IDS.ontoQueryField]: [{ t: "str", v: "[:find ?id :where" }],
      }),
    ];
    const r = resolveScope(wire, "o.bad", buildQueryDb(wire, 1), 1);
    expect(r.members.size).toBe(0);
    expect(r.warnings.some((w) => w.startsWith("onto.query failed"))).toBe(true);
  });
});

/** Adapts a node map to the resolver the row builders now take. */
const labelOf = (map: ReturnType<typeof wireToOutlineMap>) => (id: string) =>
  map.get(id)?.text?.trim() || id;

describe("member rows", () => {
  it("labels provenance and flags pins, sorted by label", () => {
    const wire = [
      tagDef("t.svc", "service"),
      tagged("n.a", "zeta", "t.svc"),
      tagged("n.b", "alpha", "t.svc"),
      node("n.p", "pinned one"),
      onto("o", "O", {
        [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: "t.svc" }],
        [SYSTEM_IDS.ontoMemberField]: [{ t: "ref", v: "n.p" }],
      }),
    ];
    const map = wireToOutlineMap(wire, new Set());
    const r = resolveScope(wire, "o", buildQueryDb(wire, 1), 1);
    const rows = memberRows(r, labelOf(map));
    expect(rows.map((x) => x.label)).toEqual(["alpha", "pinned one", "zeta"]);
    expect(rows.find((x) => x.id === "n.p")!.pinned).toBe(true);
    expect(rows.find((x) => x.id === "n.a")!.pinned).toBe(false);
    expect(rows.find((x) => x.id === "n.a")!.reasons).toEqual([{ kind: "tag", via: "t.svc" }]);
  });

  it("lists excluded ids separately", () => {
    const wire = [
      tagDef("t.svc", "service"),
      tagged("n.a", "alpha", "t.svc"),
      onto("o", "O", {
        [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: "t.svc" }],
        [SYSTEM_IDS.ontoExcludeField]: [{ t: "ref", v: "n.a" }],
      }),
    ];
    const map = wireToOutlineMap(wire, new Set());
    const r = resolveScope(wire, "o", buildQueryDb(wire, 1), 1);
    expect(memberRows(r, labelOf(map))).toEqual([]);
    expect(excludedRows(r, labelOf(map)).map((x) => x.label)).toEqual(["alpha"]);
  });

  it("an excluded node still gets its text, even when the scope omits it", () => {
    // A scoped node map cannot contain an excluded node by definition, so
    // resolving its label there always fell through to printing a raw id.
    const wire = [
      tagDef("t.svc", "service"),
      tagged("n.a", "alpha", "t.svc"),
      onto("o", "O", {
        [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: "t.svc" }],
        [SYSTEM_IDS.ontoExcludeField]: [{ t: "ref", v: "n.a" }],
      }),
    ];
    const r = resolveScope(wire, "o", buildQueryDb(wire, 1), 1);
    // A members-only map: exactly what the ontology page holds while scoped.
    const scoped = wireToOutlineMap(
      wire.filter((n) => n.id !== "n.a"),
      new Set(),
    );
    expect(excludedRows(r, labelOf(scoped)).map((x) => x.label)).toEqual(["n.a"]);
    // The page's resolver falls back to the unscoped nodes, so it recovers it.
    const unscoped = wireToOutlineMap(wire, new Set());
    const pageResolver = (id: string) =>
      unscoped.get(id)?.text?.trim() || scoped.get(id)?.text?.trim() || id;
    expect(excludedRows(r, pageResolver).map((x) => x.label)).toEqual(["alpha"]);
  });
});

describe("listOntologyItems", () => {
  it("returns #ontology nodes sorted, with a fallback label", () => {
    const wire = [...graph(), onto("o.3", "")];
    expect(listOntologyItems(wire)).toEqual([
      { id: "o.2", label: "Empty" },
      { id: "o.1", label: "Services" },
      { id: "o.3", label: "Untitled ontology" },
    ]);
  });
});
