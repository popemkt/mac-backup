import type { GraphSnapshot, WireNode } from "@kb/protocol";

const ISO = "2026-08-08T05:00:00.000Z";

function node(
  partial: Pick<WireNode, "id" | "text"> &
    Partial<Omit<WireNode, "id" | "text">>,
): WireNode {
  return {
    props: {},
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...partial,
  };
}

/** Fixture graph matching protocol.ts GraphSnapshot shape (no live server). */
export const fixtureGraph: GraphSnapshot = {
  rev: 1,
  nodes: [
    node({ id: "sys.field", text: "sys.field" }),
    node({ id: "sys.tag", text: "sys.tag" }),
    node({
      id: "sys.f.type",
      text: "type",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.fields",
      text: "fields",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "field.status",
      text: "status",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "tag.todo",
      text: "todo",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag" }],
        "sys.f.fields": [{ t: "ref", v: "field.status" }],
      },
    }),
    node({
      id: "n.root-a",
      text: "Ship kb ui shell",
      props: {
        "sys.f.type": [{ t: "ref", v: "tag.todo" }],
        "field.status": [{ t: "str", v: "doing" }],
      },
      children: ["n.child-a1", "n.child-a2"],
    }),
    node({
      id: "n.child-a1",
      text: "Load graph into client DataScript",
    }),
    node({
      id: "n.child-a2",
      text: "Render outline with collapse + zoom",
      children: ["n.grandchild"],
    }),
    node({
      id: "n.grandchild",
      text: "Persist collapsed ids in localStorage",
    }),
    node({
      id: "n.root-b",
      text: "Search jumps to matching nodes",
      props: {
        "sys.f.type": [{ t: "ref", v: "tag.todo" }],
        "field.status": [{ t: "str", v: "todo" }],
      },
    }),
    node({
      id: "n.root-c",
      text: "Read-only props panel resolves field names",
    }),
  ],
};
