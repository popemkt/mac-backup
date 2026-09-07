import { describe, expect, test } from "vitest";
import type { CanvasEdge, CanvasNode } from "@kb/canvas";
import type { WireNode } from "@kb/contracts";
import { planEdgeRelink, type EdgeRelinkContext } from "@/lib/canvas-edge-link";
import { wireToOutlineMap } from "@/lib/graph-view";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";

function wireNode(id: string, text: string, partial: Partial<WireNode> = {}): WireNode {
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...partial,
  };
}

/** A field node declaring `fieldType`, with no target constraint. */
function fieldNode(id: string, text: string, fieldType: string): WireNode {
  return wireNode(id, text, {
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: fieldType }],
    },
  });
}

function graph(sourceProps: WireNode["props"] = {}): Map<string, OutlineNode> {
  return wireToOutlineMap(
    [
      wireNode("n.a", "A", { props: sourceProps }),
      wireNode("n.b", "B"),
      fieldNode("f.link", "link", "ref"),
      fieldNode("f.note", "note", "text"),
    ],
    new Set(),
  );
}

const nodes = graph();

const cards: CanvasNode[] = [
  { id: "c1", type: "kb-node", nodeId: "n.a", x: 0, y: 0, width: 280, height: 72 },
  { id: "c2", type: "kb-node", nodeId: "n.b", x: 400, y: 0, width: 280, height: 72 },
  { id: "s1", type: "shape", shape: "rect", x: 0, y: 200, width: 160, height: 100 },
  { id: "s2", type: "shape", shape: "rect", x: 400, y: 200, width: 160, height: 100 },
];

function ctx(overrides: Partial<EdgeRelinkContext> = {}): EdgeRelinkContext {
  return {
    byId: new Map(cards.map((card) => [card.id, card])),
    nodes,
    queryDb: null,
    bindingId: "bind-new",
    ...overrides,
  };
}

function edge(from: string, to: string, kbLink?: CanvasEdge["kbLink"]): CanvasEdge {
  const built: CanvasEdge = {
    id: "e1",
    fromNode: from,
    toNode: to,
    fromSide: "right",
    toSide: "left",
    toEnd: "arrow",
  };
  return kbLink ? { ...built, kbLink } : built;
}

const layoutLink = {
  mode: "layout" as const,
  via: "prop" as const,
  fieldId: "",
  sourceNodeId: "n.a",
  targetNodeId: "n.b",
  bindingId: "bind-1",
};

describe("going native", () => {
  test("needs a link to carry the field", () => {
    expect(planEdgeRelink(edge("c1", "c2"), { kind: "mode", mode: "native" }, ctx())).toEqual({
      kind: "reject",
      reason: "Pick a ref field before enabling native mode",
    });
  });

  test("needs the link's field to be filled in", () => {
    const plan = planEdgeRelink(
      edge("c1", "c2", layoutLink),
      { kind: "mode", mode: "native" },
      ctx(),
    );
    expect(plan).toEqual({
      kind: "reject",
      reason: "Pick a ref field before enabling native mode",
    });
  });

  test("writes the edge and the one-shot prop when the field is set", () => {
    const plan = planEdgeRelink(
      edge("c1", "c2", { ...layoutLink, fieldId: "f.link" }),
      { kind: "mode", mode: "native" },
      ctx(),
    );
    expect(plan).toEqual({
      kind: "write",
      edge: expect.objectContaining({
        kbLink: { ...layoutLink, fieldId: "f.link", mode: "native" },
      }),
      props: {
        propTargetId: "n.a",
        setProps: [{ field: "f.link", value: { t: "ref", v: "n.b" } }],
      },
    });
  });

  test("skips the prop write when the source already holds the ref", () => {
    const bound = graph({ "f.link": [{ t: "ref", v: "n.b" }] });
    const plan = planEdgeRelink(
      edge("c1", "c2", { ...layoutLink, fieldId: "f.link" }),
      { kind: "mode", mode: "native" },
      ctx({ nodes: bound }),
    );
    expect(plan).toMatchObject({ props: { propTargetId: "n.a", setProps: undefined } });
  });

  test("refuses a field that is not a ref field", () => {
    expect(
      planEdgeRelink(
        edge("c1", "c2", { ...layoutLink, fieldId: "f.note" }),
        { kind: "mode", mode: "native" },
        ctx(),
      ),
    ).toEqual({ kind: "reject", reason: "Target not allowed for this ref field" });
  });
});

describe("going back to layout", () => {
  test("keeps the field and writes no prop", () => {
    const plan = planEdgeRelink(
      edge("c1", "c2", { ...layoutLink, fieldId: "f.link", mode: "native" }),
      { kind: "mode", mode: "layout" },
      ctx(),
    );
    expect(plan).toEqual({
      kind: "write",
      edge: expect.objectContaining({
        kbLink: { ...layoutLink, fieldId: "f.link", mode: "layout" },
      }),
    });
  });

  test("mints a binding id for a link that has none", () => {
    const plan = planEdgeRelink(
      edge("c1", "c2", { ...layoutLink, bindingId: "" }),
      { kind: "mode", mode: "layout" },
      ctx(),
    );
    expect(plan).toMatchObject({ edge: { kbLink: { bindingId: "" } } });
  });
});

describe("an edge between cards that are not kb nodes", () => {
  test("moves the mode and nothing else", () => {
    const plan = planEdgeRelink(
      edge("s1", "s2", { ...layoutLink, fieldId: "f.link" }),
      { kind: "mode", mode: "native" },
      ctx(),
    );
    expect(plan).toEqual({
      kind: "write",
      edge: expect.objectContaining({
        kbLink: { ...layoutLink, fieldId: "f.link", mode: "native" },
      }),
    });
  });

  test("downgrades native without a field to layout", () => {
    const plan = planEdgeRelink(
      edge("s1", "s2", layoutLink),
      { kind: "mode", mode: "native" },
      ctx(),
    );
    expect(plan).toMatchObject({ edge: { kbLink: { mode: "layout" } } });
  });

  test("has no field to choose", () => {
    expect(
      planEdgeRelink(edge("s1", "s2", layoutLink), { kind: "field", fieldId: "f.link" }, ctx()),
    ).toEqual({ kind: "none" });
  });
});

describe("choosing a field", () => {
  test("is choosing native mode with that field", () => {
    const plan = planEdgeRelink(
      edge("c1", "c2", layoutLink),
      { kind: "field", fieldId: "f.link" },
      ctx(),
    );
    expect(plan).toEqual({
      kind: "write",
      edge: expect.objectContaining({
        kbLink: { ...layoutLink, fieldId: "f.link", mode: "native" },
      }),
      props: {
        propTargetId: "n.a",
        setProps: [{ field: "f.link", value: { t: "ref", v: "n.b" } }],
      },
    });
  });

  test("uses the context binding id when the edge has no link", () => {
    const plan = planEdgeRelink(edge("c1", "c2"), { kind: "field", fieldId: "f.link" }, ctx());
    expect(plan).toMatchObject({ edge: { kbLink: { bindingId: "bind-new" } } });
  });

  test("the empty option is not an allowed target", () => {
    expect(
      planEdgeRelink(edge("c1", "c2", layoutLink), { kind: "field", fieldId: "" }, ctx()),
    ).toEqual({ kind: "reject", reason: "Target not allowed for this ref field" });
  });
});
