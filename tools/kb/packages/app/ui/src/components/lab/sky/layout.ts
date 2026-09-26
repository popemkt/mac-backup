/**
 * Where the graph's nodes stand in the sky: a pure function of node ids and
 * the lens cluster, so a node keeps its star when others come and go.
 *
 * The sky is a volume, not a dome. A cluster (a constellation) picks a
 * direction and a depth, and its nodes gather round that point, so siblings
 * form a real 3D group: flying round the sun and moon, near constellations
 * slide across far ones (parallax), and a constellation seen from the side
 * is no longer the shape it was from the front.
 */
import { sphereDirection, unitHash, type SpherePlace } from "@/scene/sphere";
import type { LabNode } from "@/components/lab/lab-graph";

/** How far from the centre of the sky stars stand, world units. */
const NEAREST = 55;
const FARTHEST = 150;
/** Spread of one cluster round its centre: across the sky (radians) and in depth. */
const CLUSTER_SPREAD = 0.16;
const CLUSTER_DEPTH = 10;

/**
 * Where the brightest glints hang before any orbit: near the thirds of the
 * first view, clear of the frame's edges, the header and the info card, and
 * of the moon (P1). Yaw and pitch in radians round the first view's axis.
 */
const HERO_PLACES: readonly SpherePlace[] = [
  { yaw: -0.3, pitch: 0.2 },
  { yaw: 0.36, pitch: -0.17 },
  { yaw: -0.1, pitch: -0.26 },
];
const HERO_DEPTH = 80;

/** How many glints are heroes; the rest are smaller, and sit with their siblings. */
export const HERO_GLINTS = HERO_PLACES.length;

type Point = readonly [number, number, number];

function at(place: SpherePlace, depth: number): Point {
  const [x, y, z] = sphereDirection(place);
  return [x * depth, y * depth, z * depth];
}

/** The `rank`-th most recent glint's point, if it is one of the heroes. */
export function heroPoint(rank: number): Point | undefined {
  const place = HERO_PLACES[rank];
  return place === undefined ? undefined : at(place, HERO_DEPTH);
}

/**
 * A node's point in the sky. Its lens cluster (parent, by default) picks a
 * centre — a direction anywhere round the sky and a depth — and the node sits
 * near it.
 */
export function starPoint(node: Pick<LabNode, "id" | "cluster">): Point {
  const centreYaw = unitHash(`${node.cluster}:yaw`) * Math.PI * 2;
  const centrePitch = (unitHash(`${node.cluster}:pitch`) * 2 - 1) * 1.1;
  const depth = NEAREST + unitHash(`${node.cluster}:depth`) * (FARTHEST - NEAREST);
  const angle = unitHash(`${node.id}:angle`) * Math.PI * 2;
  const reach = Math.sqrt(unitHash(`${node.id}:reach`)) * CLUSTER_SPREAD;
  return at(
    {
      yaw: centreYaw + Math.cos(angle) * reach,
      pitch: Math.max(-1.35, Math.min(1.35, centrePitch + Math.sin(angle) * reach)),
    },
    depth + (unitHash(`${node.id}:depth`) - 0.5) * CLUSTER_DEPTH,
  );
}
