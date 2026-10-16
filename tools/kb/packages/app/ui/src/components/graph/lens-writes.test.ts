/**
 * The graph writes its view nodes through the page's write port: these tests
 * hold it to that port (a test host), not to the shell's mutations.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type PageWrites, type PropValue, SYSTEM_IDS, syncUiPlugins } from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import { decodePerspective, perspectiveProps } from "@kb/graph";
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
    addViewNode: (text: string, props: Record<string, PropValue[]>) => {
      calls.push(["addViewNode", text, props]);
      return Promise.resolve("n.view");
    },
  };
  syncUiPlugins([]);
  syncUiPlugins([testHostPlugin({ ...host, writes })]);
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

  it("saves a perspective as a view node of its props, named or defaulted", async () => {
    expect(await saveGraphPerspective(perspective, "  Mine ")).toBe("n.view");
    await saveGraphPerspective(perspective, "   ");
    expect(calls).toEqual([
      ["addViewNode", "Mine", perspectiveProps(perspective)],
      ["addViewNode", "Graph perspective", perspectiveProps(perspective)],
    ]);
  });
});
