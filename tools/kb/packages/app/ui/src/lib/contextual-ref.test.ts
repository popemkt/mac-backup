/**
 * Contextual references — the data half. A contextual reference is an ordinary
 * node carrying `sys.f.ref.target`; it displays the target's *current* text,
 * and editing that text edits the target.
 */
import {
  contextualTargetOf,
  DatascriptIndex,
  isContextualRef,
  queryBacklinks,
  rowText,
  rowTextOf,
  rowTextReadOnlyReason,
  schemaOf,
  shownNode,
  shownNodeId,
  showsAncestor,
  SYSTEM_IDS,
  wireToOutlineMap,
  type NodeMap,
  type SchemaIndex,
} from "@kb/ui-sdk";
import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import { REF_SEED_WIRES, ctxRefWire } from "@/fixtures/contextual-ref";
import { fixtureGraph } from "@/api/fixture-graph";

/** The one constructor, over an unscoped graph: the whole map is the schema. */
function schemaFor(nodes: NodeMap): SchemaIndex {
  return schemaOf({ ontologyId: null, nodes, wireNodes: [] });
}

const ISO = "2026-08-08T05:00:00.000Z";

function wire(partial: Partial<WireNode> & Pick<WireNode, "id">): WireNode {
  return {
    text: "",
    props: {},
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...partial,
  };
}

function mapWith(extra: WireNode[]): NodeMap {
  return wireToOutlineMap([...fixtureGraph.nodes, ...REF_SEED_WIRES, ...extra], new Set());
}

describe("contextual reference model", () => {
  it("recognises a node carrying a target on sys.f.ref.target", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.root-a")]);
    const ref = present(nodes.get("n.ctx"), "n.ctx");
    expect(isContextualRef(ref)).toBe(true);
    expect(contextualTargetOf(ref)).toBe("n.root-a");
  });

  it("the target field alone decides — an empty target is an ordinary node", () => {
    const nodes = mapWith([
      wire({
        id: "n.blank",
        text: "plain",
        props: { [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "" }] },
      }),
      wire({ id: "n.none", text: "plain" }),
    ]);
    expect(isContextualRef(nodes.get("n.blank"))).toBe(false);
    expect(contextualTargetOf(nodes.get("n.blank"))).toBeNull();
    expect(isContextualRef(nodes.get("n.none"))).toBe(false);
  });

  it("a node merely TAGGED `ref` is not a reference — the field is the kind", () => {
    const nodes = mapWith([
      wire({
        id: "t.ref",
        text: "ref",
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
      }),
      wire({
        id: "n.tagged",
        text: "tagged, not a reference",
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.ref" }] },
      }),
    ]);
    expect(isContextualRef(nodes.get("n.tagged"))).toBe(false);
    expect(contextualTargetOf(nodes.get("n.tagged"))).toBeNull();
  });

  it("renders the target's current text verbatim, so markdown still renders", () => {
    const nodes = mapWith([
      ctxRefWire("n.ctx", "n.md"),
      wire({ id: "n.md", text: "Original — **bold** and `code`" }),
    ]);
    expect(rowText(present(nodes.get("n.ctx"), "n.ctx"), schemaFor(nodes))).toBe(
      "Original — **bold** and `code`",
    );
    // Ordinary rows are untouched — one function, one answer.
    expect(rowText(present(nodes.get("n.root-b"), "n.root-b"), schemaFor(nodes))).toBe(
      "Search jumps to matching nodes",
    );
  });

  it("a dangling target renders as the [[id]] token, never blank or a throw", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.gone")]);
    expect(rowText(present(nodes.get("n.ctx"), "n.ctx"), schemaFor(nodes))).toBe("[[n.gone]]");
  });

  it("resolves with no seed nodes present at all — the prop is self-contained", () => {
    // An ontology-scoped wire set may carry neither the field node nor any tag
    // node. The old reader asked the kind slot for a `#ref` tag and went quiet
    // when that tag was out of scope; a prop value needs nothing else in the
    // graph, which is the point of reading one carrier.
    const nodes = wireToOutlineMap(
      [...fixtureGraph.nodes, ctxRefWire("n.ctx", "n.root-a")],
      new Set(),
    );
    const ref = present(nodes.get("n.ctx"), "n.ctx");
    expect(ref.tags).toEqual([]);
    expect(isContextualRef(ref)).toBe(true);
    expect(contextualTargetOf(ref)).toBe("n.root-a");
  });

  it("a row shows, edits and opens its target; every other row itself", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.root-a")]);
    expect(shownNodeId(present(nodes.get("n.ctx"), "n.ctx"))).toBe("n.root-a");
    expect(shownNodeId(present(nodes.get("n.root-b"), "n.root-b"))).toBe("n.root-b");
    const state = { ontologyId: null, nodes, wireNodes: [] };
    expect(rowTextOf(state, "n.ctx")).toEqual({ text: "Ship kb ui shell", textNodeId: "n.root-a" });
    expect(rowTextOf(state, "n.missing")).toEqual({ text: "", textNodeId: "n.missing" });
  });

  it("owns the read-only-text rule: sys text and missing targets, never a live reference", () => {
    const nodes = mapWith([
      ctxRefWire("n.ctx", "n.root-a"),
      ctxRefWire("n.to-sys", "sys.f.query"),
      ctxRefWire("n.dangling", "n.gone"),
    ]);
    const schema = schemaFor(nodes);
    // A live reference edits its original in place.
    expect(rowTextReadOnlyReason("n.ctx", nodes.get("n.ctx"), schema)).toBeNull();
    // The rule is about the text on screen: a reference to a sys node is as
    // read-only as the sys node itself.
    expect(rowTextReadOnlyReason("n.to-sys", nodes.get("n.to-sys"), schema)).toBe(
      "System node — read-only",
    );
    expect(rowTextReadOnlyReason("sys.f.query", nodes.get("sys.f.query"), schema)).toBe(
      "System node — read-only",
    );
    // A dangling reference has no text to write to.
    expect(rowTextReadOnlyReason("n.dangling", nodes.get("n.dangling"), schema)).toBe(
      "Reference target is missing",
    );
    expect(rowTextReadOnlyReason("n.root-a", nodes.get("n.root-a"), schema)).toBeNull();
  });
});

describe("the shown node", () => {
  it("is the target for a reference, the row itself otherwise and when dangling", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.root-a"), ctxRefWire("n.dangling", "n.gone")]);
    const schema = schemaFor(nodes);
    const at = (id: string) => shownNode(present(nodes.get(id), id), schema).id;
    expect(at("n.ctx")).toBe("n.root-a");
    expect(at("n.root-a")).toBe("n.root-a");
    expect(at("n.dangling")).toBe("n.dangling");
  });

  it("repeats an ancestor when a row above already shows its node, on any key form", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.root-a")]);
    const schema = schemaFor(nodes);
    const ref = present(nodes.get("n.ctx"), "n.ctx");
    expect(showsAncestor("tree/n.root-a/n.ctx", ref, schema)).toBe(true);
    expect(showsAncestor("ref:query:n.root-a/n.ctx", ref, schema)).toBe(true);
    // Another reference to the same target above it counts: it shows that node too.
    expect(showsAncestor("tree/n.ctx/n.child-a1/n.ctx", ref, schema)).toBe(true);
    expect(showsAncestor("tree/n.ctx", ref, schema)).toBe(false);
    expect(showsAncestor("tree/n.root-b/n.ctx", ref, schema)).toBe(false);
  });
});

describe("references section reach", () => {
  it("a contextual reference shows up in the target's backlinks", () => {
    const db = new DatascriptIndex([
      ...fixtureGraph.nodes,
      ...REF_SEED_WIRES,
      ctxRefWire("n.ctx", "n.root-a"),
    ]);
    expect(queryBacklinks(db, "n.root-a").map((b) => b.id)).toContain("n.ctx");
  });

  it("a plain text mention still resolves, so the relation is one relation", () => {
    const referrer = wire({
      id: "n.referrer",
      text: "See [[n.root-a|Ship kb ui shell]] for context",
    });
    const db = new DatascriptIndex([...fixtureGraph.nodes, referrer]);
    expect(queryBacklinks(db, "n.root-a").map((b) => b.id)).toEqual(["n.referrer"]);
  });
});
