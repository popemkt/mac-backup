/**
 * A graph view's lens (`lens.ts`): a malformed setting is reported and falls
 * back, a perspective's props read back as its lens, and the lens reads its
 * focus and query as every view's subject does.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS } from "@kb/model";
import { subjectRootProps } from "@kb/views";
import {
  decodeLensConfig,
  encodeLensConfig,
  rendererParamsOf,
  type LensPerspective,
  GRAPH_IDS,
  TreeView,
} from "@kb/graph";
import { savedProps } from "./fixtures.ts";

function strict(): (warning: string) => void {
  return (warning) => {
    throw new Error(`reported: ${warning}`);
  };
}

describe("a graph view's lens", () => {
  test("a malformed lens prop is reported to the caller's sink and falls back", () => {
    const warnings: string[] = [];
    const lens = decodeLensConfig(
      { [GRAPH_IDS.lensLayoutField]: [{ t: "str", v: "spiral" }] },
      (w) => warnings.push(w),
    );
    expect(lens.layout).toBe("force");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(GRAPH_IDS.lensLayoutField);
  });

  test("a perspective's props read back as its lens", () => {
    const perspective: LensPerspective = {
      id: "n.p",
      label: "P",
      query: "[:find ?id :where [?n :node/id ?id]]",
      renderer: "sys.view.graph.tree",
      colorBy: "tag",
      labelBy: "text",
      sizeBy: "degree",
      edgeKinds: [],
      maxNodes: 40,
      clusterBy: "parent",
      focus: "n.root",
      hops: 2,
      layout: "radial",
      spread: 90,
      linkDistance: 30,
      showLabels: false,
      edgeLabels: true,
      autorotate: true,
      labelDensity: "high",
      theme: "matte",
      linkStyle: "straight",
      traceFrom: "n.a",
      traceTo: "n.b",
      tracePaths: 2,
    };
    const props = savedProps(TreeView, perspective);
    expect(props[SYSTEM_IDS.viewField]).toEqual([{ t: "ref", v: perspective.renderer }]);
    // Every param the renderer declares, the whole lens among them, reads back.
    const { renderer: hosted, ...read } = decodeLensConfig(props, strict());
    expect(read).toMatchObject(rendererParamsOf(TreeView, perspective));
    // A graph view node's renderer is its view; it names no hosted renderer.
    expect(props[GRAPH_IDS.lensRendererField]).toBeUndefined();
    expect(hosted).toBe("sys.view.graph.force2d");
  });

  test("the lens writes and reads its focus and query as the subject does", () => {
    expect(encodeLensConfig({ focus: "n.root" })).toEqual(subjectRootProps("n.root"));
    const lens = decodeLensConfig(
      {
        ...subjectRootProps("n.root"),
        [SYSTEM_IDS.lensQueryField]: [{ t: "str", v: "[:find ?id]" }],
      },
      strict(),
    );
    expect(lens.focus).toBe("n.root");
    expect(lens.query).toBe("[:find ?id]");
  });
});
