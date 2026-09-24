import type { GraphSnapshot, WireNode } from "@kb/contracts";
import { systemSeedNodes } from "@kb/model";

const ISO = "2026-08-08T05:00:00.000Z";

function node(
  partial: Pick<WireNode, "id" | "text"> & Partial<Omit<WireNode, "id" | "text">>,
): WireNode {
  return {
    props: {},
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...partial,
  };
}

const SEED = new Map(systemSeedNodes(ISO).map((seed) => [seed.id, seed]));

/**
 * A system field as the seed declares it.
 *
 * The offline graph chooses which system fields it carries; what each one
 * *is* — its name and props, its declared value type among them — is the
 * seed's, so a declaration added there reaches this graph without a second
 * copy kept in step by hand. Children are left out: the option nodes they
 * name are not part of this graph.
 */
function seedField(id: string): WireNode {
  const seed = SEED.get(id);
  if (seed === undefined) throw new Error(`fixture graph names an unseeded field: ${id}`);
  return node({ id, text: seed.text, props: seed.props });
}

/**
 * The offline graph, in `GraphSnapshot` shape.
 *
 * This is product code, not test data, which is why it sits beside
 * `api/graph.ts` rather than under `fixtures/`. `loadGraph` serves it when
 * `VITE_USE_FIXTURES` is set or the server is unreachable at cold boot, and
 * the store records `loadSource: "fixtures"` — the flag `actions/mutations`
 * reads to keep every write local. The `fixtures/` folder next door is
 * test-only seeds, which no production module may import.
 *
 * The test suites seed from it as well: one demo workspace, described once.
 */
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
    seedField("sys.f.type"),
    seedField("sys.f.fields"),
    seedField("sys.f.hidden"),
    seedField("sys.f.color"),
    seedField("sys.f.fieldType"),
    seedField("sys.f.targetTag"),
    seedField("sys.f.targetQuery"),
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
    seedField("sys.f.query"),
    seedField("sys.f.query.limit"),
    seedField("sys.f.lens.query"),
    seedField("sys.f.lens.renderer"),
    seedField("sys.f.lens.color-by"),
    seedField("sys.f.lens.size-by"),
    seedField("sys.f.lens.edge-kinds"),
    seedField("sys.f.lens.max-nodes"),
    seedField("sys.f.lens.cluster-by"),
    seedField("sys.f.lens.focus"),
    seedField("sys.f.lens.layout"),
    seedField("sys.f.lens.spread"),
    seedField("sys.f.lens.link-distance"),
    seedField("sys.f.lens.show-labels"),
    seedField("sys.f.lens.curved-links"),
    seedField("sys.f.lens.autorotate"),
    seedField("sys.f.lens.label-density"),
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
