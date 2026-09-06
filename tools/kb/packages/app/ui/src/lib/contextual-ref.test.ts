/**
 * Contextual references — the data half. A contextual reference is an ordinary
 * node carrying `sys.f.ref.target`; it displays the target's *current* text,
 * and its own text is never the row's own to edit.
 */
import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import { DatascriptIndex, queryBacklinks } from "@/ds";
import { REF_SEED_WIRES, ctxRefWire } from "@/fixtures/contextual-ref";
import { fixtureGraph } from "@/fixtures/graph";
import {
  contextualTargetOf,
  isContextualRef,
  rowText,
  rowTextReadOnlyReason,
} from "@/lib/contextual-ref";
import { wireToOutlineMap } from "@/lib/graph-view";
import { SYSTEM_IDS, type NodeMap } from "@/lib/types";

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
    expect(rowText(present(nodes.get("n.ctx"), "n.ctx"), nodes)).toBe(
      "Original — **bold** and `code`",
    );
    // Ordinary rows are untouched — one function, one answer.
    expect(rowText(present(nodes.get("n.root-b"), "n.root-b"), nodes)).toBe(
      "Search jumps to matching nodes",
    );
  });

  it("a dangling target renders as the [[id]] token, never blank or a throw", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.gone")]);
    expect(rowText(present(nodes.get("n.ctx"), "n.ctx"), nodes)).toBe("[[n.gone]]");
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

  it("owns the read-only-text rule for sys rows and reference rows alike", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.root-a")]);
    expect(rowTextReadOnlyReason("n.ctx", nodes.get("n.ctx"))).toBe(
      "Reference — edit the original",
    );
    expect(rowTextReadOnlyReason("sys.f.query", nodes.get("sys.f.query"))).toBe(
      "System node — read-only",
    );
    expect(rowTextReadOnlyReason("n.root-a", nodes.get("n.root-a"))).toBeNull();
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
