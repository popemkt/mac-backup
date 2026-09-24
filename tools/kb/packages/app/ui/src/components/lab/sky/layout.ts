/**
 * Where the graph's nodes sit on the sky: a pure function of node ids and
 * the lens cluster, so a node keeps its star when others come and go.
 */
import { djb2Hash } from "@/lib/tag-color";
import type { LabNode } from "@/components/lab/lab-graph";

/** A stable number in [0, 1) for a key. */
export function unitHash(key: string): number {
  return (djb2Hash(key) >>> 0) / 0x1_0000_0000;
}

/** Stars fill the half of the sky in front; a pan past it finds only dust. */
const STAR_YAW = 1.6;
const STAR_PITCH = 0.45;
/** Spread of one cluster (a constellation) around its centre, in radians. */
const CLUSTER_SPREAD = 0.16;

export interface SkyPlace {
  readonly yaw: number;
  readonly pitch: number;
}

/**
 * A node's place on the sky. Its lens cluster (parent, by default) picks a
 * centre, and the node sits near it: siblings gather into a constellation.
 */
export function starPlace(node: Pick<LabNode, "id" | "cluster">): SkyPlace {
  const centreYaw = (unitHash(`${node.cluster}:yaw`) * 2 - 1) * STAR_YAW;
  const centrePitch = (unitHash(`${node.cluster}:pitch`) * 2 - 1) * STAR_PITCH;
  const angle = unitHash(`${node.id}:angle`) * Math.PI * 2;
  const reach = Math.sqrt(unitHash(`${node.id}:reach`)) * CLUSTER_SPREAD;
  return {
    yaw: centreYaw + Math.cos(angle) * reach,
    pitch: Math.max(-1.2, Math.min(1.2, centrePitch + Math.sin(angle) * reach)),
  };
}

/** A direction on the unit sphere for a sky place; -z is straight ahead. */
export function skyDirection(place: SkyPlace): readonly [number, number, number] {
  const ring = Math.cos(place.pitch);
  return [Math.sin(place.yaw) * ring, Math.sin(place.pitch), -Math.cos(place.yaw) * ring];
}
