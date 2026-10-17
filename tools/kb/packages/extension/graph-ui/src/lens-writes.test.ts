/**
 * The graph writes its view nodes through the page's host: these tests hold
 * it to that host (a test host), not to the shell's mutations.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  type PageWrites,
  type PropValue,
  SYSTEM_IDS,
  syncUiPlugins,
  type ViewProposal,
} from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import { decodePerspective, TreeView } from "@kb/graph";
import { saveGraphPerspective, setGraphRenderer, setLensProp } from "./lens-writes";

type Call = readonly [string, ...unknown[]];

let calls: Call[];

beforeEach(() => {
  calls = [];
  const host = testBrowserHost();
  const writes: PageWrites = {
    ...host.writes,
    replaceField: (nodeId: string, fieldId: string, values: PropValue[]) => {
      calls.push(["replaceField", nodeId, fieldId, values]);
      return Promise.resolve();
    },
  };
  const proposeView = (proposal: ViewProposal) => {
    calls.push(["proposeView", proposal]);
    return Promise.resolve({ id: "n.view" });
  };
  syncUiPlugins([]);
  syncUiPlugins([testHostPlugin({ ...host, writes, proposeView })]);
});

afterAll(() => syncUiPlugins([]));

const perspective = decodePerspective(
  {
    id: "perspective",
    text: "Perspective",
    props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: "sys.view.graph.tree" }] },
  },
  () => {},
);

describe("lens writes", () => {
  it("replaces the renderer — the graph view's view — whole, so no one sees it unset", async () => {
    await setGraphRenderer(perspective.id, "sys.view.graph.force3d");
    expect(calls).toEqual([
      [
        "replaceField",
        perspective.id,
        SYSTEM_IDS.viewField,
        [{ t: "ref", v: "sys.view.graph.force3d" }],
      ],
    ]);
  });

  it("replaces every lens field whole with its one value", async () => {
    await setLensProp(perspective.id, "lens.field", { t: "num", v: 3 });
    expect(calls).toEqual([["replaceField", perspective.id, "lens.field", [{ t: "num", v: 3 }]]]);
  });

  it("proposes a perspective as a view node of its renderer's params, named or defaulted", async () => {
    expect(await saveGraphPerspective(TreeView, perspective, "  Mine ")).toEqual({ id: "n.view" });
    await saveGraphPerspective(TreeView, perspective, "   ");
    const { query, focus, hops, edgeKinds, maxNodes, colorBy, labelBy, sizeBy, clusterBy } =
      perspective;
    const params = {
      query,
      focus,
      hops,
      edgeKinds,
      maxNodes,
      colorBy,
      labelBy,
      sizeBy,
      clusterBy,
      traceFrom: null,
      traceTo: null,
      tracePaths: null,
      showLabels: perspective.showLabels,
    };
    expect(calls).toEqual([
      ["proposeView", { view: TreeView, params, text: "Mine" }],
      ["proposeView", { view: TreeView, params, text: "Graph perspective" }],
    ]);
  });
});
