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
      id: "sys.f.hidden",
      text: "hidden",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.color",
      text: "color",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.fieldType",
      text: "fieldType",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.targetTag",
      text: "targetTag",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.targetQuery",
      text: "targetQuery",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({ id: "sys.command", text: "sys.command" }),
    node({
      id: "sys.cmd.add-node",
      text: "Add node",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.add-tag",
      text: "Add tag",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.define-field",
      text: "Define field",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.go-query",
      text: "Go to query page",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.new-query",
      text: "New query node",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.debug-show-fields",
      text: "Debug: show all fields",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.expand-all",
      text: "Expand all",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.collapse-all",
      text: "Collapse all",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.f.query",
      text: "query",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.query.limit",
      text: "limit",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.tag.query",
      text: "query",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag" }],
        "sys.f.fields": [
          { t: "ref", v: "sys.f.query" },
          { t: "ref", v: "sys.f.query.limit" },
        ],
      },
    }),
    node({
      id: "sys.f.lens.query",
      text: "lens.query",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.renderer",
      text: "lens.renderer",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.color-by",
      text: "lens.color-by",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.size-by",
      text: "lens.size-by",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.edge-kinds",
      text: "lens.edge-kinds",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.max-nodes",
      text: "lens.max-nodes",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.tag.graph-perspective",
      text: "graph-perspective",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag" }],
        "sys.f.fields": [
          { t: "ref", v: "sys.f.lens.query" },
          { t: "ref", v: "sys.f.lens.renderer" },
          { t: "ref", v: "sys.f.lens.color-by" },
          { t: "ref", v: "sys.f.lens.size-by" },
          { t: "ref", v: "sys.f.lens.edge-kinds" },
          { t: "ref", v: "sys.f.lens.max-nodes" },
        ],
      },
    }),
    node({
      id: "sys.lens.all-mentions",
      text: "All mentions",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag.graph-perspective" }],
        "sys.f.lens.renderer": [{ t: "str", v: "force2d" }],
        "sys.f.lens.edge-kinds": [
          { t: "str", v: "mention" },
          { t: "str", v: "child" },
        ],
      },
    }),
    node({
      id: "field.status",
      text: "status",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "field.noisy",
      text: "noisy",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.field" }],
        "sys.f.hidden": [{ t: "bool", v: true }],
      },
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
        "field.noisy": [{ t: "str", v: "internal" }],
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
