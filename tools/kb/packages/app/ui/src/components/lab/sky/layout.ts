/**
 * Where the graph's nodes sit on the sky: a pure function of node ids and
 * the lens cluster, so a node keeps its star when others come and go.
 */
import { unitHash, type SpherePlace } from "@/scene/sphere";
import type { LabNode } from "@/components/lab/lab-graph";

/**
 * Where the brightest glints hang before any pan: near the thirds of the
 * view, clear of the frame's edges, the header and the info card, and of the
 * sun or moon (P1). Yaw and pitch in radians for the lab's field of view.
 */
const HERO_PLACES: readonly SpherePlace[] = [
  { yaw: -0.27, pitch: 0.16 },
  { yaw: 0.3, pitch: -0.15 },
  { yaw: -0.08, pitch: -0.22 },
];

/** How many glints are heroes; the rest are smaller, and sit with their siblings. */
export const HERO_GLINTS = HERO_PLACES.length;

/** The `rank`-th most recent glint's place, if it is one of the heroes. */
export function heroPlace(rank: number): SpherePlace | undefined {
  return HERO_PLACES[rank];
}

/** Stars fill the half of the sky in front; a pan past it finds only dust. */
const STAR_YAW = 1.6;
const STAR_PITCH = 0.45;
/** Spread of one cluster (a constellation) around its centre, in radians. */
const CLUSTER_SPREAD = 0.16;

/**
 * A node's place on the sky. Its lens cluster (parent, by default) picks a
 * centre, and the node sits near it: siblings gather into a constellation.
 */
export function starPlace(node: Pick<LabNode, "id" | "cluster">): SpherePlace {
  const centreYaw = (unitHash(`${node.cluster}:yaw`) * 2 - 1) * STAR_YAW;
  const centrePitch = (unitHash(`${node.cluster}:pitch`) * 2 - 1) * STAR_PITCH;
  const angle = unitHash(`${node.id}:angle`) * Math.PI * 2;
  const reach = Math.sqrt(unitHash(`${node.id}:reach`)) * CLUSTER_SPREAD;
  return {
    yaw: centreYaw + Math.cos(angle) * reach,
    pitch: Math.max(-1.2, Math.min(1.2, centrePitch + Math.sin(angle) * reach)),
  };
}
