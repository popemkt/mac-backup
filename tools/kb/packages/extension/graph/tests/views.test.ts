/**
 * The graph's view keys as a host reads and opens them: a neighbourhood is
 * shown for its host and reads its stored lens, and a renderer's page is the
 * graph page drawing the view node it is shown through. These cases moved
 * here from `@kb/views`' tests, which now use core's views.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { SYSTEM_IDS, viewOptionId, type NodeProps } from "@kb/model";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import { issueText, paramsFromProps, resolveNodeView, viewCatalogOf, viewNodeFor } from "@kb/views";
import {
  GRAPH_IDS,
  GraphView,
  NeighbourhoodView,
  TreeView,
  decodeLensConfig,
  rendererParamsOf,
  type LensPerspective,
} from "../src/index.ts";
import { perspective } from "./fixtures.ts";

const quiet = () => {};

describe("the graph's view keys", () => {
  test("a neighbourhood with no stored focus is rooted at the node it is shown for", () => {
    const shownFor = paramsFromProps(NeighbourhoodView, {}, "n.host", quiet);
    expect(Result.getOrThrow(shownFor).root).toBe("n.host");
  });

  test("a neighbourhood shown for its host reads its root back from what it stores", () => {
    const params = {
      root: "n.a",
      hops: 2,
      edges: ["mention"],
      renderer: "sys.view.graph.tree",
      settings: {
        layout: "force",
        spread: 150,
        linkDistance: 60,
        showLabels: true,
        autorotate: false,
        labelDensity: "medium",
        theme: "matte",
        linkStyle: "straight",
      },
    };
    const proposed = viewNodeFor(NeighbourhoodView, params, "n.other");
    expect(Result.isFailure(proposed) ? proposed.failure.map(issueText) : []).toEqual([]);
  });

  describe("a proposed graph view", () => {
    const lens = {
      query: "[:find ?id :where [?n :node/id ?id]]",
      focus: "n.root",
      hops: 2,
      edgeKinds: ["mention", "prop:field.depends"],
      maxNodes: 40,
      colorBy: "prop:field.team",
      labelBy: "prop:field.title",
      sizeBy: "children",
      clusterBy: "parent",
    } satisfies Partial<LensPerspective>;

    test("sets which nodes it draws and how they map, as it sets its renderer's settings", () => {
      const proposed = Result.getOrThrow(
        viewNodeFor(TreeView, { ...lens, showLabels: false }, null),
      );
      expect(proposed.props[SYSTEM_IDS.viewField]).toEqual([{ t: "ref", v: TreeView.option }]);
      expect(decodeLensConfig(proposed.props, quiet)).toMatchObject({ ...lens, showLabels: false });
    });

    test("holds no setting its renderer does not read", () => {
      const proposed = viewNodeFor(TreeView, { ...lens, showLabels: true, spread: 90 }, null);
      expect(Result.isFailure(proposed) ? proposed.failure.map((issue) => issue.path) : []).toEqual(
        [["spread"]],
      );
    });

    test("a perspective proposes the params its renderer declares, which read back", () => {
      const params = rendererParamsOf(TreeView, perspective({ ...lens, spread: 90 }));
      expect(params).not.toHaveProperty("spread");
      const proposed = viewNodeFor(TreeView, params, null);
      expect(Result.isFailure(proposed) ? proposed.failure.map(issueText) : []).toEqual([]);
    });
  });

  describe("what /node/<id> opens", () => {
    const catalog = viewCatalogOf(
      BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.views ?? []),
    );
    const nodes = new Map<string, { props: NodeProps }>([
      ["n.frame", { props: { [SYSTEM_IDS.viewsField]: [{ t: "ref", v: "v.hood" }] } }],
      [
        "v.hood",
        {
          props: {
            [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("graph.neighbourhood") }],
            [GRAPH_IDS.lensHopsField]: [{ t: "num", v: 2 }],
          },
        },
      ],
      [
        "v.graph",
        { props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("graph.force2d") }] } },
      ],
    ]);
    const openHeld = (node: string, view?: string) => {
      const target = Result.getOrThrow(
        resolveNodeView(
          view === undefined ? { node } : { node, view },
          catalog,
          (id) => nodes.get(id),
          quiet,
        ),
      );
      if (target.key === null) throw new Error(`${node} resolved to a view no key holds`);
      return target;
    };

    test("a node opens through its neighbourhood view, read for it", () => {
      const hood = openHeld("n.frame", "v.hood");
      expect(hood.key).toBe(NeighbourhoodView);
      expect(hood.input).toMatchObject({ root: "n.frame", hops: 2 });
    });

    test("a node opens as the neighbourhood view type, by the type's option", () => {
      const hood = openHeld("n.frame", NeighbourhoodView.option);
      expect(hood.key).toBe(NeighbourhoodView);
      expect(hood.input).toMatchObject({ root: "n.frame", hops: 1 });
    });

    test("a renderer's page is the graph page drawing the view node", () => {
      expect(openHeld("v.graph").key).toBe(GraphView);
      expect(openHeld("v.graph").input).toEqual({ perspective: "v.graph" });
    });
  });
});
