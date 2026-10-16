/**
 * The layout view type: its params (a split-and-tab tree of panes), how a
 * view node holds them, the tree's edits, and what `/node/<id>` opens.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Result } from "effect";
import { SYSTEM_IDS, present, viewOptionId, type NodeProps } from "@kb/model";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";
import {
  LayoutView,
  OutlineSnippetView,
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

/** What a node opens as when the view the data names for it is broken, warning `why`. */
function broken(node: string, why: string) {
  return {
    target: Result.succeed({ key: null, listed: null, broken: why, subject: node }),
    warnings: [why],
  };
}

/** What `/node/<node>` opens over `graph` through catalog `on`, and the warnings it reports. */
function openIn(
  graph: ReadonlyMap<string, { props: NodeProps; text?: string }>,
  node: string,
  on: Parameters<typeof resolveNodeView>[1] = catalog,
) {
  const warnings: string[] = [];
  const target = resolveNodeView(
    { node },
    on,
    (id) => graph.get(id),
    (w) => warnings.push(w),
  );
  return { target, warnings };
}

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
  /** The views list as every store is seeded with it: it names the default view type. */
  const seededViews = present(
    bundledSeed().find((node) => node.id === SYSTEM_IDS.viewsRoot),
    "the bundled seed declares sys.views",
  );
  const nodes = new Map<string, { props: NodeProps }>([
    [SYSTEM_IDS.viewsRoot, { props: seededViews.props }],
    ["n.plain", { props: {} }],
    [
      "n.frame",
      {
        props: {
          [SYSTEM_IDS.viewsField]: [
            { t: "ref", v: "v.table" },
            { t: "ref", v: "v.snippet" },
          ],
        },
      },
    ],
    [
      "v.table",
      { props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("outline.table") }] } },
    ],
    [
      "v.snippet",
      {
        props: {
          [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("outline.snippet") }],
        },
      },
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
      throw new Error(
        `${node} resolved to ${target.listed?.id ?? "a broken view"}, held by no key`,
      );
    return target;
  };

  test("a node that names no view opens in the seeded default view type: the outline at it", () => {
    expect(open("n.plain")).toEqual(
      Result.succeed({ key: OutlineView, input: { root: "n.plain" }, subject: "n.plain" }),
    );
  });

  /** `nodes` with `sys.views` naming `option` as the default view type (none for null). */
  const withDefault = (option: string | null) =>
    new Map<string, { props: NodeProps; text?: string }>([
      ...nodes,
      [
        SYSTEM_IDS.viewsRoot,
        {
          props:
            option === null ? {} : { [SYSTEM_IDS.viewDefaultField]: [{ t: "ref", v: option }] },
        },
      ],
    ]);

  test("the default view type is data: a node that names no view opens as if it named it", () => {
    const graph = withDefault(OutlineSnippetView.option);
    expect(openIn(graph, "n.plain")).toEqual({
      target: open("n.plain", OutlineSnippetView.option),
      warnings: [],
    });
    // A node that names a view still opens in its own.
    expect(openIn(graph, "n.frame").target).toEqual(open("n.frame"));
  });

  test("a default view type the host holds no key for opens as that view, unavailable here", () => {
    const off = viewCatalogOf(catalog.items.filter((item) => item.key !== OutlineSnippetView));
    const graph = new Map([
      ...withDefault(OutlineSnippetView.option),
      [OutlineSnippetView.option, { props: {}, text: "Outline snippet" }],
    ]);
    expect(openIn(graph, "n.plain", off)).toEqual({
      target: Result.succeed({
        key: null,
        listed: { id: "outline.snippet", label: "Outline snippet" },
        subject: "n.plain",
      }),
      warnings: [],
    });
  });

  test("a default view type missing, or naming no view type, opens as broken, reported, never failing", () => {
    const missing = `sys.views names no default view type (${SYSTEM_IDS.viewDefaultField})`;
    expect(openIn(withDefault(null), "n.plain")).toEqual(broken("n.plain", missing));
    const notAType = `sys.views's default view type v.table is no view type (${SYSTEM_IDS.viewDefaultField})`;
    expect(openIn(withDefault("v.table"), "n.plain")).toEqual(broken("n.plain", notAType));
  });

  test("a view node the data names that is gone opens as broken; one a location names fails", () => {
    const graph = new Map([
      ...nodes,
      ["n.orphaned", { props: { [SYSTEM_IDS.viewsField]: [{ t: "ref" as const, v: "v.gone" }] } }],
      [
        "v.unknown",
        { props: { [SYSTEM_IDS.viewField]: [{ t: "ref" as const, v: "sys.view.nope" }] } },
      ],
    ]);
    expect(openIn(graph, "n.orphaned")).toEqual(broken("n.orphaned", "v.gone is no view node"));
    expect(openIn(graph, "v.unknown")).toEqual(broken("v.unknown", "v.unknown is no view node"));
    // The location is wrong, not the data: there is nothing to open.
    expect(open("n.plain", "v.gone")).toEqual(Result.fail("v.gone is no view node"));
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
    const snippet = openHeld("n.frame", "v.snippet");
    expect(snippet.key).toBe(OutlineSnippetView);
    expect(snippet.input).toMatchObject({ root: "n.frame", depth: 1 });
  });

  test("a node opens as a view type, by the type's option", () => {
    const snippet = openHeld("n.plain", OutlineSnippetView.option);
    expect(snippet.key).toBe(OutlineSnippetView);
    expect(snippet.input).toMatchObject({ root: "n.plain", depth: 1 });
  });

  test("a view node opens as itself", () => {
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
    const listed = catalog.entries().find((entry) => entry.id === "outline.snippet");
    if (listed === undefined) throw new Error("the bundled catalog lists outline.snippet");
    const unheld = viewCatalogOf(
      catalog.items.filter((item) => item.key !== OutlineSnippetView),
      [listed],
    );
    const openUnheld = (node: string, view?: string) =>
      resolveNodeView(
        view === undefined ? { node } : { node, view },
        unheld,
        (id) => nodes.get(id),
        () => {},
      );
    expect(openUnheld("n.frame", "v.snippet")).toEqual(
      Result.succeed({ key: null, listed, subject: "v.snippet", viewNode: "v.snippet" }),
    );
    expect(openUnheld("v.snippet")).toEqual(
      Result.succeed({ key: null, listed, subject: "v.snippet", viewNode: "v.snippet" }),
    );
    expect(openUnheld("n.plain", OutlineSnippetView.option)).toEqual(
      Result.succeed({ key: null, listed, subject: "n.plain" }),
    );
    expect(openUnheld("n.plain", "sys.view.nope")).toEqual(Result.fail("no view nope"));
  });

  test("a view no catalog lists resolves to its option node's name, when the graph holds the option", () => {
    // A family switched off: its views leave the catalog, but its option nodes are seeded.
    const off = viewCatalogOf(catalog.items.filter((item) => item.key !== OutlineSnippetView));
    const withOption = new Map<string, { props: NodeProps; text?: string }>([
      ...nodes,
      [OutlineSnippetView.option, { props: {}, text: "Outline snippet" }],
    ]);
    const openOff = (graph: typeof withOption, node: string, view?: string) =>
      resolveNodeView(
        view === undefined ? { node } : { node, view },
        off,
        (id) => graph.get(id),
        () => {},
      );
    const listed = { id: "outline.snippet", label: "Outline snippet" };
    expect(openOff(withOption, "n.frame", "v.snippet")).toEqual(
      Result.succeed({ key: null, listed, subject: "v.snippet", viewNode: "v.snippet" }),
    );
    expect(openOff(withOption, "n.plain", OutlineSnippetView.option)).toEqual(
      Result.succeed({ key: null, listed, subject: "n.plain" }),
    );
    // Without the option, nothing names the view: the node's view is no view.
    expect(openOff(nodes, "n.frame", "v.snippet")).toEqual(
      Result.fail("v.snippet is no view node"),
    );
  });
});
