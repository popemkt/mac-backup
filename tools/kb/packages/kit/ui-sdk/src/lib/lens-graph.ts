/**
 * The lens graph of a perspective, as a service: the nodes and edges a graph
 * view node's lens draws of the page's graph. The graph's browser half owns
 * the one extraction and provides it while it is loaded; a half that draws
 * the graph without being the graph (the lab) injects the service, so it
 * waits, pending, while the graph is off, and imports nothing of the graph's
 * family.
 */
import type { WireNode } from "@kb/contracts";
import { Service } from "@kb/plugin";
import type { KbIndex } from "../query";
import type { BulletAppearance } from "./bullet-mode";

export interface LensNode {
  id: string;
  label: string;
  color: string;
  size: number;
  clusterKey: string;
  /** Human presentation of the cluster identity, resolved before renderer projection. */
  clusterLabel?: string;
  tags: string[];
  tagIds?: string[];
  degree: number;
  weight?: number;
  colorKey?: string;
  colorLabel?: string;
  /** The bullet the outline draws for this node, where a renderer draws it so (`lib/bullet-mode`). */
  bullet?: BulletAppearance;
}

/** One edge of a lens graph: from one of its nodes to another, drawn once. */
export interface LensGraphEdge {
  readonly source: string;
  readonly target: string;
}

export interface LensGraph {
  nodes: LensNode[];
  edges: readonly LensGraphEdge[];
  /** Nodes dropped by max-nodes cap. */
  dropped: number;
  /** Query parse/exec error message, if any. */
  queryError: string | null;
}

/**
 * What the service answers: the lens graph of the graph view node
 * `perspectiveId` names, else of the default perspective the graph page opens
 * on, over `index` and `wireNodes`. Null when there is no perspective to draw.
 */
export interface LensGraphs {
  readonly ofPerspective: (
    index: KbIndex,
    wireNodes: readonly WireNode[],
    perspectiveId: string | null,
  ) => LensGraph | null;
}

/** Where the graph's browser half provides the lens graphs while it is loaded. */
export const LensGraphService = Service<LensGraphs>()("ui.graph.lens");
