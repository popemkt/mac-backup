/**
 * A view's node-link graph, as a service: the nodes and links a view node
 * draws of the page's graph. A family that draws such a view owns the one
 * extraction and provides it while it is loaded; a half that reads it without
 * drawing that view (the lab's Sky) injects the service, so it waits,
 * pending, while no family provides it, and imports nothing of that family.
 * The shape is what such a reader reads; the family that draws it carries
 * more on each node.
 */
import type { WireNode } from "@kb/contracts";
import { Service } from "@kb/plugin";
import type { KbIndex } from "../query";

export interface NodeLinkNode {
  readonly id: string;
  readonly label: string;
  /** How many links it has. */
  readonly degree: number;
  /** The group it sits with: nodes with one key are drawn together. */
  readonly clusterKey: string;
}

/** One link of a node-link graph: from one of its nodes to another, drawn once. */
export interface NodeLinkEdge {
  readonly source: string;
  readonly target: string;
}

export interface NodeLinkGraph {
  readonly nodes: readonly NodeLinkNode[];
  readonly edges: readonly NodeLinkEdge[];
}

/**
 * What the service answers: the node-link graph of the view node `viewId`
 * names, else of the default one its family opens on, over `index` and
 * `wireNodes`. Null when there is no view node to draw.
 */
export interface NodeLinkGraphs {
  readonly ofView: (
    index: KbIndex,
    wireNodes: readonly WireNode[],
    viewId: string | null,
  ) => NodeLinkGraph | null;
}

/** Where a family provides its node-link graphs while it is loaded. */
export const NodeLinkGraphService = Service<NodeLinkGraphs>()("ui.node-link");
