import { SYSTEM_IDS } from "@kb/model";
import { DEFAULT_EDGE_KINDS, DEFAULT_MAX_NODES, type LensPerspective } from "@kb/graph";
import type { LensSource } from "../src/index.ts";

/** A node as the projection reads it, with no props or children unless given. */
export function node(
  partial: Pick<LensSource, "id" | "text"> & Partial<Omit<LensSource, "id" | "text">>,
): LensSource {
  return { props: {}, children: [], ...partial };
}

/** The seeded all-mentions perspective at every lens default, with `patch` over it. */
export function perspective(patch: Partial<LensPerspective> = {}): LensPerspective {
  return {
    id: SYSTEM_IDS.lensAllMentions,
    label: "All mentions",
    query: "",
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
    ...patch,
  };
}
