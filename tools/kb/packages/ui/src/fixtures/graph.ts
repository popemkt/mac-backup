import type { GraphSnapshot, WireNode } from "@kb/contracts";

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
    node({
      id: "sys.tag",
      text: "sys.tag",
      props: {
        "sys.f.fields": [
          { t: "ref", v: "sys.f.color" },
          { t: "ref", v: "sys.f.hidden" },
        ],
      },
    }),
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
      id: "sys.cmd.view-as-list",
      text: "View as: List",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.view-as-table",
      text: "View as: Table",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.view-as-board",
      text: "View as: Board",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.view-as-cards",
      text: "View as: Cards",
      props: { "sys.f.type": [{ t: "ref", v: "sys.command" }] },
    }),
    node({
      id: "sys.cmd.view-filter",
      text: "Filter…",
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
      id: "sys.f.lens.cluster-by",
      text: "lens.cluster-by",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.focus",
      text: "lens.focus",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.layout",
      text: "lens.layout",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.spread",
      text: "lens.spread",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.link-distance",
      text: "lens.link-distance",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.show-labels",
      text: "lens.show-labels",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.curved-links",
      text: "lens.curved-links",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.autorotate",
      text: "lens.autorotate",
      props: { "sys.f.type": [{ t: "ref", v: "sys.field" }] },
    }),
    node({
      id: "sys.f.lens.label-density",
      text: "lens.label-density",
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
          { t: "ref", v: "sys.f.lens.cluster-by" },
          { t: "ref", v: "sys.f.lens.focus" },
          { t: "ref", v: "sys.f.lens.layout" },
          { t: "ref", v: "sys.f.lens.spread" },
          { t: "ref", v: "sys.f.lens.link-distance" },
          { t: "ref", v: "sys.f.lens.show-labels" },
          { t: "ref", v: "sys.f.lens.curved-links" },
          { t: "ref", v: "sys.f.lens.autorotate" },
          { t: "ref", v: "sys.f.lens.label-density" },
        ],
      },
    }),
    node({
      id: "lens.all-mentions",
      text: "All mentions",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag.graph-perspective" }],
        "sys.f.lens.renderer": [{ t: "str", v: "force2d" }],
        "sys.f.lens.cluster-by": [{ t: "str", v: "parent" }],
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
