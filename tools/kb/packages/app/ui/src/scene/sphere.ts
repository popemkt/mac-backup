/**
 * Places on a sphere around the viewer, as yaw and pitch, and a seeded hash
 * to scatter them: the sky's stars and every scene's starfield stand here.
 */
import { djb2Hash } from "@/lib/tag-color";

/**
 * A stable number in [0, 1) for a key. djb2 alone keeps near-identical keys
 * (ULIDs minted in one burst) near-identical, which laid siblings out as
 * dotted arcs; murmur3's finaliser scatters every bit.
 */
export function unitHash(key: string): number {
  let h = djb2Hash(key) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

export interface SpherePlace {
  readonly yaw: number;
  readonly pitch: number;
}

/** A direction on the unit sphere for a place; -z is straight ahead. */
export function sphereDirection(place: SpherePlace): readonly [number, number, number] {
  const ring = Math.cos(place.pitch);
  return [Math.sin(place.yaw) * ring, Math.sin(place.pitch), -Math.cos(place.yaw) * ring];
}

/** The `i`-th of a seeded, evenly spread scatter of places named `seed`. */
export function scatterPlace(seed: string, i: number): SpherePlace {
  return {
    yaw: unitHash(`${seed}:${i}:yaw`) * Math.PI * 2,
    pitch: Math.asin(unitHash(`${seed}:${i}:pitch`) * 2 - 1),
  };
}
