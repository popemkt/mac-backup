import { Result } from "effect";
import type { NodeId, PropValue } from "@kb/model";
import { viewNodeFor } from "@kb/views";
import {
  DEFAULT_EDGE_KINDS,
  DEFAULT_MAX_NODES,
  GRAPH_IDS,
  type LensPerspective,
  type LensSource,
  type RendererKey,
  rendererParamsOf,
} from "@kb/graph";

/** A node as the projection reads it, with no props or children unless given. */
export function node(
  partial: Pick<LensSource, "id" | "text"> & Partial<Omit<LensSource, "id" | "text">>,
): LensSource {
  return { props: {}, children: [], ...partial };
}

/** The seeded all-mentions perspective at every lens default, with `patch` over it. */
export function perspective(patch: Partial<LensPerspective> = {}): LensPerspective {
  return {
    id: GRAPH_IDS.lensAllMentions,
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

/**
 * The props saving `p` as a graph view node of `renderer` writes, as the
 * graph saves a copy: the params the renderer declares (`rendererParamsOf`),
 * proposed as any view node is (`viewNodeFor`).
 */
export function savedProps(
  renderer: RendererKey<unknown>,
  p: LensPerspective,
): Record<NodeId, PropValue[]> {
  const proposed = viewNodeFor(renderer, rendererParamsOf(renderer, p), null);
  if (Result.isFailure(proposed))
    throw new Error(proposed.failure.map((issue) => issue.message).join("; "));
  return proposed.success.props;
}
