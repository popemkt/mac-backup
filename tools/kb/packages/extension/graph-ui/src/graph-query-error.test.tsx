/**
 * A perspective whose node query cannot run reaches the graph page as an
 * error drawn in place of the canvas: the extraction reports it on the
 * graph's own lens graph (`GraphLens.queryError`, which the kit's
 * node-link shape does not carry), and the frame the page draws it through
 * shows it, keeping its toolbar.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { DatascriptIndex } from "@kb/ui-sdk";
import { DEFAULT_EDGE_KINDS, DEFAULT_MAX_NODES, GRAPH_IDS, type LensPerspective } from "@kb/graph";
import { extractLensGraph } from "./graph-lens";
import { GraphCanvasFrame } from "./graph-canvas-frame";
import meta, { QueryError } from "./graph-canvas-frame.stories";

const NODES: WireNode[] = [
  { id: "n.a", text: "A", props: {}, children: [], createdAt: "", updatedAt: "" },
];

const PERSPECTIVE: LensPerspective = {
  id: GRAPH_IDS.lensAllMentions,
  label: "All mentions",
  query: "[:find ?id :where [?n :node/id",
  renderer: "sys.view.graph.force2d",
  colorBy: "tag",
  sizeBy: "degree",
  edgeKinds: [...DEFAULT_EDGE_KINDS],
  maxNodes: DEFAULT_MAX_NODES,
  clusterBy: "none",
  focus: null,
  hops: null,
  layout: "force",
  spread: 150,
  linkDistance: 60,
  showLabels: true,
  autorotate: false,
  labelDensity: "medium",
  theme: "matte",
  linkStyle: "straight",
};

describe("a perspective whose query cannot run", () => {
  it("is reported on the graph's lens graph, which draws no nodes", () => {
    const graph = extractLensGraph(new DatascriptIndex(NODES), NODES, PERSPECTIVE);
    expect(graph.queryError).not.toBeNull();
    expect(graph.nodes).toEqual([]);
  });

  it("is drawn by the frame in place of the canvas, beside the toolbar", () => {
    const html = renderToStaticMarkup(
      createElement(GraphCanvasFrame, { ...meta.args, ...QueryError.args }),
    );
    expect(html).toContain("Graph query error");
    expect(html).toContain("unknown tag id");
    expect(html).not.toContain("renderer canvas");
  });
});
