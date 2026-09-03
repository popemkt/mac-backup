/**
 * Contextual references — the data half. A contextual reference is an ordinary
 * node tagged #ref (sys.tag.ref) carrying `sys.f.ref.target`; it displays the
 * target's *current* text, and its own text is never the row's own to edit.
 */
import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { buildQueryDb, queryBacklinks } from "@/ds/db";
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
  return wireToOutlineMap(
    [...fixtureGraph.nodes, ...REF_SEED_WIRES, ...extra],
    new Set(),
  );
}

describe("contextual reference model", () => {
  it("recognises a #ref-tagged node carrying a target", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.root-a")]);
    const ref = nodes.get("n.ctx")!;
    expect(isContextualRef(ref)).toBe(true);
    expect(contextualTargetOf(ref)).toBe("n.root-a");
  });

  it("needs both the tag and the prop — either alone is an ordinary node", () => {
    const nodes = mapWith([
      wire({
        id: "n.tagonly",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.refTag }],
        },
      }),
      wire({
        id: "n.proponly",
        text: "plain",
        props: {
          [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "n.root-a" }],
        },
      }),
    ]);
    expect(isContextualRef(nodes.get("n.tagonly"))).toBe(false);
    expect(isContextualRef(nodes.get("n.proponly"))).toBe(false);
    expect(contextualTargetOf(nodes.get("n.proponly"))).toBeNull();
  });

  it("renders the target's current text verbatim, so markdown still renders", () => {
    const nodes = mapWith([
      ctxRefWire("n.ctx", "n.md"),
      wire({ id: "n.md", text: "Original — **bold** and `code`" }),
    ]);
    expect(rowText(nodes.get("n.ctx")!, nodes)).toBe(
      "Original — **bold** and `code`",
    );
    // Ordinary rows are untouched — one function, one answer.
    expect(rowText(nodes.get("n.root-b")!, nodes)).toBe(
      "Search jumps to matching nodes",
    );
  });

  it("a dangling target renders as the [[id]] token, never blank or a throw", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.gone")]);
    expect(rowText(nodes.get("n.ctx")!, nodes)).toBe("[[n.gone]]");
  });

  it("reads the kind slot, not the badge list, to decide it is a reference", () => {
    // Same graph minus the `#ref` tag NODE — which is what an ontology-scoped
    // wire set looks like. `resolveTags` drops a badge whose target is not a
    // known tag node, so a badge-based test ("t.id === sys.tag.ref") reports
    // the row as ordinary and the reference silently stops resolving.
    const nodes = wireToOutlineMap(
      [...fixtureGraph.nodes, ctxRefWire("n.ctx", "n.root-a")],
      new Set(),
    );
    const ref = nodes.get("n.ctx")!;
    expect(ref.tags.map((t) => t.id)).not.toContain(SYSTEM_IDS.refTag);
    expect(isContextualRef(ref)).toBe(true);
    expect(contextualTargetOf(ref)).toBe("n.root-a");
  });

  it("owns the read-only-text rule for sys rows and reference rows alike", () => {
    const nodes = mapWith([ctxRefWire("n.ctx", "n.root-a")]);
    expect(rowTextReadOnlyReason("n.ctx", nodes.get("n.ctx"))).toBe(
      "Reference — edit the original",
    );
    expect(
      rowTextReadOnlyReason("sys.tag.query", nodes.get("sys.tag.query")),
    ).toBe("System node — read-only");
    expect(rowTextReadOnlyReason("n.root-a", nodes.get("n.root-a"))).toBeNull();
  });
});

describe("references section reach", () => {
  it("a contextual reference shows up in the target's backlinks", () => {
    const db = buildQueryDb(
      [...fixtureGraph.nodes, ...REF_SEED_WIRES, ctxRefWire("n.ctx", "n.root-a")],
      1,
    );
    expect(queryBacklinks(db, "n.root-a").map((b) => b.id)).toContain("n.ctx");
  });

  it("a plain text mention still resolves, so the relation is one relation", () => {
    const referrer = wire({
      id: "n.referrer",
      text: "See [[n.root-a|Ship kb ui shell]] for context",
    });
    const db = buildQueryDb([...fixtureGraph.nodes, referrer], 1);
    expect(queryBacklinks(db, "n.root-a").map((b) => b.id)).toEqual([
      "n.referrer",
    ]);
  });
});
