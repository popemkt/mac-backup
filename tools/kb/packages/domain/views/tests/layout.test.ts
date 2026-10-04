/**
 * The layout view type: its params (a split-and-tab tree of panes), how a
 * view node holds them, the tree's edits, and what `/node/<id>` opens.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Result } from "effect";
import { SYSTEM_IDS, viewOptionId, type NodeProps } from "@kb/model";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  GraphView,
  LayoutView,
  NeighbourhoodView,
  OutlineView,
  closePane,
  decodeLayout,
  freshPaneId,
  issueText,
  layoutPanes,
  neighbourOf,
  normalizeLayout,
  openBeside,
  paramsFromProps,
  resolveNodeView,
  sameLayout,
  singlePane,
  viewCatalogOf,
  viewNodeFor,
  withPanePath,
  type LayoutTree,
} from "@kb/views";

/** The catalog a server holding every bundled family lists. */
const catalog = viewCatalogOf(
  BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.views ?? []),
);

const pane = (id: string, path = `/node/${id}`) => ({ id, path });
const tabs = (...ids: string[]): LayoutTree => {
  const [first, ...rest] = ids.map((id) => pane(id));
  if (first === undefined) throw new Error("tabs need a pane");
  return { tabs: [first, ...rest] };
};

function issues(input: unknown): string {
  const decoded = decodeLayout(input);
  return Result.isFailure(decoded) ? decoded.failure : "";
}

describe("layout params", () => {
  test("a tabs group or a split of layouts decodes as itself", () => {
    const tree: LayoutTree = {
      split: "row",
      children: [tabs("a"), { split: "column", children: [tabs("b", "c"), tabs("d")] }],
      sizes: [0.4, 0.6],
    };
    expect(decodeLayout(tree)).toEqual(Result.succeed(tree));
    expect(decodeLayout({ tabs: [pane("a"), pane("b")], active: "b" })).toEqual(
      Result.succeed({ tabs: [pane("a"), pane("b")], active: "b" }),
    );
  });

  test("refuses what no screen can show", () => {
    expect(issues({ split: "row", children: [tabs("a"), tabs("a")] })).toContain("used twice");
    expect(issues({ tabs: [pane("a")], active: "b" })).toContain("active names no tab");
    expect(issues({ split: "row", children: [tabs("a")] })).not.toBe("");
    expect(
      issues({
        split: "row",
        children: [tabs("a"), { split: "row", children: [tabs("b"), tabs("c")] }],
      }),
    ).toContain("runs across it");
    expect(issues({ split: "row", children: [tabs("a"), tabs("b")], sizes: [0.5, 0.2] })).toContain(
      "sum to",
    );
    expect(issues({ split: "row", children: [tabs("a"), tabs("b")], sizes: [0.5] })).toContain(
      "1 entries for 2 children",
    );
    expect(issues({ tabs: [{ id: "a/b", path: "/" }] })).not.toBe("");
    expect(issues({ tabs: [{ id: "a", path: "graph" }] })).not.toBe("");
    expect(issues({ tabs: [] })).not.toBe("");
  });

  test("a view node holds the arrangement as one JSON prop and reads it back", () => {
    const root: LayoutTree = { split: "row", children: [tabs("a"), tabs("b")] };
    const proposed = Result.getOrThrow(viewNodeFor(LayoutView, { root }, null));
    expect(proposed.props[SYSTEM_IDS.viewField]).toEqual([{ t: "ref", v: LayoutView.option }]);
    expect(proposed.props[SYSTEM_IDS.layoutField]).toHaveLength(1);
    expect(paramsFromProps(LayoutView, proposed.props, null, () => {})).toEqual(
      Result.succeed({ root }),
    );
  });

  test("an arrangement that is not JSON is reported, and the view has none", () => {
    const reported: string[] = [];
    const props: NodeProps = { [SYSTEM_IDS.layoutField]: [{ t: "str", v: "{nope" }] };
    expect(
      Result.isFailure(paramsFromProps(LayoutView, props, null, (w) => reported.push(w))),
    ).toBe(true);
    expect(reported).toEqual([`${SYSTEM_IDS.layoutField} is not JSON`]);
  });

  test("a proposal with an illegal arrangement says where", () => {
    const proposed = viewNodeFor(LayoutView, { root: { tabs: [pane("a"), pane("a")] } }, null);
    expect(Result.isFailure(proposed) ? proposed.failure.map(issueText).join() : "").toContain(
      "used twice",
    );
  });
});

describe("layout edits", () => {
  test("opening beside a pane puts a new column to its right", () => {
    const one = singlePane(pane("main", "/"));
    const two = openBeside(one, "main", pane("p2"));
    expect(two).toEqual({ split: "row", children: [one, tabs("p2")] });
    const three = openBeside(two, "main", pane("p3"));
    expect(layoutPanes(three).map((p) => p.id)).toEqual(["main", "p3", "p2"]);
    // Beside a pane in a column: a new column of the row it sits in.
    const stacked: LayoutTree = {
      split: "row",
      children: [{ split: "column", children: [tabs("a"), tabs("b")] }, tabs("c")],
    };
    expect(openBeside(stacked, "b", pane("d"))).toEqual({
      split: "row",
      children: [{ split: "column", children: [tabs("a"), tabs("b")] }, tabs("d"), tabs("c")],
    });
  });

  test("closing a pane collapses what it leaves, and never closes the last one", () => {
    const tree: LayoutTree = {
      split: "row",
      children: [
        tabs("a"),
        {
          split: "column",
          children: [tabs("b"), { split: "row", children: [tabs("c"), tabs("d")] }],
        },
      ],
      sizes: [0.5, 0.5],
    };
    expect(closePane(tree, "b")).toEqual({
      split: "row",
      children: [tabs("a"), tabs("c"), tabs("d")],
    });
    expect(closePane(tabs("a"), "a")).toEqual(tabs("a"));
    expect(closePane({ tabs: [pane("a"), pane("b")], active: "b" }, "b")).toEqual(tabs("a"));
    expect(closePane(tree, "nope")).toEqual(tree);
  });

  test("a closed pane hands focus to its neighbour, and new panes take a free id", () => {
    const tree: LayoutTree = { split: "row", children: [tabs("main"), tabs("p2"), tabs("p3")] };
    expect(neighbourOf(tree, "p2")).toBe("main");
    expect(neighbourOf(tree, "main")).toBe("p2");
    expect(freshPaneId(tree)).toBe("p4");
    expect(freshPaneId(tabs("main", "p3"))).toBe("p2");
  });

  test("a pane goes somewhere else by its path alone", () => {
    const tree = withPanePath(tabs("a", "b"), "b", "/graph");
    expect(layoutPanes(tree)).toEqual([pane("a"), { id: "b", path: "/graph" }]);
    expect(withPanePath(tree, "b", "/graph")).toEqual(tree);
  });

  test("every edit of a legal layout is a legal layout (fast-check)", () => {
    const edits = fc.array(
      fc.oneof(
        fc.record({
          kind: fc.constant("open" as const),
          at: fc.nat(),
          path: fc.constantFrom("/", "/graph"),
        }),
        fc.record({ kind: fc.constant("close" as const), at: fc.nat() }),
      ),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(edits, (steps) => {
        let tree = singlePane(pane("main", "/"));
        for (const step of steps) {
          const ids = layoutPanes(tree).map((p) => p.id);
          const target = ids[step.at % ids.length] ?? "main";
          tree =
            step.kind === "open"
              ? openBeside(tree, target, pane(freshPaneId(tree), step.path))
              : closePane(tree, target);
          expect(Result.isSuccess(decodeLayout(tree))).toBe(true);
          expect(sameLayout(normalizeLayout(tree), tree)).toBe(true);
        }
      }),
    );
  });
});

describe("what /node/<id> opens", () => {
  const nodes = new Map<string, { props: NodeProps }>([
    ["n.plain", { props: {} }],
    [
      "n.frame",
      {
        props: {
          [SYSTEM_IDS.viewsField]: [
            { t: "ref", v: "v.table" },
            { t: "ref", v: "v.hood" },
          ],
        },
      },
    ],
    [
      "v.table",
      { props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("outline.table") }] } },
    ],
    [
      "v.hood",
      {
        props: {
          [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("graph.neighbourhood") }],
          [SYSTEM_IDS.lensHopsField]: [{ t: "num", v: 2 }],
        },
      },
    ],
    [
      "v.graph",
      { props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("graph.force2d") }] } },
    ],
    [
      "v.layout",
      {
        props: {
          [SYSTEM_IDS.viewField]: [{ t: "ref", v: LayoutView.option }],
          [SYSTEM_IDS.layoutField]: [{ t: "str", v: JSON.stringify(tabs("a")) }],
        },
      },
    ],
  ]);
  const open = (node: string, view?: string) =>
    resolveNodeView(
      view === undefined ? { node } : { node, view },
      catalog,
      (id) => nodes.get(id),
      () => {},
    );
  /** What `open` resolves to, for a view the catalog holds the key of. */
  const openHeld = (node: string, view?: string) => {
    const target = Result.getOrThrow(open(node, view));
    if (target.key === null)
      throw new Error(`${node} resolved to ${target.listed.id}, held by no key`);
    return target;
  };

  test("a node that names no view opens as the outline at it", () => {
    expect(open("n.plain")).toEqual(
      Result.succeed({ key: OutlineView, input: { root: "n.plain" }, subject: "n.plain" }),
    );
  });

  test("a node opens in its default view; a frame view's page is the outline at the frame", () => {
    expect(open("n.frame")).toEqual(
      Result.succeed({
        key: OutlineView,
        input: { root: "n.frame" },
        subject: "v.table",
        viewNode: "v.table",
      }),
    );
  });

  test("a node opens through any one of its views, read for it", () => {
    const hood = openHeld("n.frame", "v.hood");
    expect(hood.key).toBe(NeighbourhoodView);
    expect(hood.input).toMatchObject({ root: "n.frame", hops: 2 });
  });

  test("a node opens as a view type, by the type's option", () => {
    const hood = openHeld("n.plain", NeighbourhoodView.option);
    expect(hood.key).toBe(NeighbourhoodView);
    expect(hood.input).toMatchObject({ root: "n.plain", hops: 1 });
  });

  test("a view node opens as itself; a renderer's page is the graph page drawing it", () => {
    expect(openHeld("v.graph").key).toBe(GraphView);
    expect(openHeld("v.graph").input).toEqual({ perspective: "v.graph" });
    const layout = openHeld("v.layout");
    expect(layout.key).toBe(LayoutView);
    expect(layout.input).toEqual({ root: tabs("a") });
  });

  test("a missing node, or a view that is none, is said so", () => {
    expect(open("n.missing")).toEqual(Result.fail("no node n.missing"));
    expect(open("n.plain", "n.plain")).toEqual(Result.fail("n.plain is no view node"));
    expect(open("n.plain", "sys.view.nope")).toEqual(Result.fail("no view nope"));
  });

  test("a view the catalog lists without its key resolves to that listing, not a failure", () => {
    const listed = catalog.entries().find((entry) => entry.id === "graph.neighbourhood");
    if (listed === undefined) throw new Error("the bundled catalog lists graph.neighbourhood");
    const unheld = viewCatalogOf(
      catalog.items.filter((item) => item.key !== NeighbourhoodView),
      [listed],
    );
    const openUnheld = (node: string, view?: string) =>
      resolveNodeView(
        view === undefined ? { node } : { node, view },
        unheld,
        (id) => nodes.get(id),
        () => {},
      );
    expect(openUnheld("n.frame", "v.hood")).toEqual(
      Result.succeed({ key: null, listed, subject: "v.hood", viewNode: "v.hood" }),
    );
    expect(openUnheld("v.hood")).toEqual(
      Result.succeed({ key: null, listed, subject: "v.hood", viewNode: "v.hood" }),
    );
    expect(openUnheld("n.plain", NeighbourhoodView.option)).toEqual(
      Result.succeed({ key: null, listed, subject: "n.plain" }),
    );
    expect(openUnheld("n.plain", "sys.view.nope")).toEqual(Result.fail("no view nope"));
  });
});
