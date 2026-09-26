/**
 * The 3D node's light, as numbers (Lab principle L2): the rig baked into the
 * node material, the glow that lifts it past white and the lift that never
 * does, written once (`shadeNode`) over the scene kit's shading arithmetic:
 * `force3d-nodes` runs it as TSL nodes, a test runs it as numbers, so the
 * test proves which light crosses the bloom threshold (1) for any colour of
 * the shader itself. No three here.
 */

import { NUMBER_OPS, type Rgb, type ShadeOps } from "@/scene/shade-ops";

export type { Rgb };

const NODE_LIGHT = {
  /** The key's share of the node colour where it faces the light… */
  key: 0.5,
  /** …the fill's share everywhere (the dark side keeps the node's colour)… */
  fill: 0.42,
  /** …and the ink rim's share at the silhouette. */
  rim: 0.16,
  /** How far past white a fully glowing node's colour goes. */
  glowGain: 2.4,
  /** How far a glowing node's light whitens toward its core. */
  glowWhite: 0.25,
} as const;

/** The key light's direction in view space (toward the upper left, toward the viewer). */
export const KEY_DIRECTION: readonly [number, number, number] = (() => {
  const [x, y, z] = [-0.45, 0.62, 0.64];
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
})();
/** How sharply the rim falls off from the silhouette. */
export const RIM_POWER = 2.4;

/**
 * The (key, rim) pairs a visible point of the sphere can see, sampled once.
 *
 * The rim depends only on the normal's angle θ from the view axis, so each
 * ring of the visible half has one rim; round the ring the key runs over an
 * interval whose ends are exact, `cosθ·k_z ∓ sinθ·√(k_x² + k_y²)` clamped at
 * 0. Every term of the light grows with the key, so a ring's brightest
 * fragment is at the top of its interval: sampling each ring's two ends and a
 * few points between reaches the sphere's peak without sweeping the surface.
 */
const RINGS = 32;
const SPHERE: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  const [kx, ky, kz] = KEY_DIRECTION;
  const spread = Math.hypot(kx, ky);
  for (let i = 0; i <= RINGS; i++) {
    const theta = (i / RINGS) * (Math.PI / 2);
    const rim = (1 - Math.cos(theta)) ** RIM_POWER;
    const low = Math.max(0, Math.cos(theta) * kz - Math.sin(theta) * spread);
    const high = Math.max(0, Math.cos(theta) * kz + Math.sin(theta) * spread);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) out.push([low + (high - low) * t, rim]);
  }
  return out;
})();

/** What one fragment of a node is shaded from, over colours V and scalars S. */
export interface NodeFragment<V, S> {
  /** The node's colour, and the palette's ground and ink (linear). */
  readonly hue: V;
  readonly ground: V;
  readonly ink: V;
  /** The key light's reach at this fragment, and the rim's (0–1). */
  readonly key: S;
  readonly rim: S;
  /** How present the node is: 1 in full, toward 0 it sinks into the ground. */
  readonly presence: S;
  /** Light that may pass white, so blooms (focus, hover, a match, a hub). */
  readonly glow: S;
  /** Light that never passes white (the rising tier, a focus's neighbours). */
  readonly lift: S;
}

/**
 * The node light, stated once over `ShadeOps`: the node material runs it as
 * TSL nodes, and `peakChannel` runs it as numbers, so what the test proves is
 * what the shader draws. The rig's light is capped at white (a resting node
 * is matte whatever its colour), a `glow` is added on top and may pass white,
 * and a `lift` is capped at the fragment's own headroom under white, channel
 * by channel, so it never does.
 */
export function shadeNode<V, S>(o: ShadeOps<V, S>, f: NodeFragment<V, S>): V {
  const L = NODE_LIGHT;
  const lit = o.addColor(
    o.scale(f.hue, o.add(o.mul(f.key, o.num(L.key)), o.num(L.fill))),
    o.scale(f.ink, o.mul(f.rim, o.num(L.rim))),
  );
  const rest = o.minColor(o.mix(f.ground, lit, f.presence), o.white);
  const light = o.scale(o.mix(f.hue, o.white, o.num(L.glowWhite)), o.num(L.glowGain));
  const glowing = o.addColor(rest, o.scale(light, f.glow));
  const room = o.divColor(o.maxColor(o.subColor(o.white, glowing), o.black), light);
  return o.addColor(glowing, o.scale(light, o.min(f.lift, o.minChannel(room))));
}

/**
 * The brightest channel a fully present node of linear colour `hue` reaches
 * anywhere on its visible surface, under `ink` (the palette's ink, linear),
 * with a blooming `glow` and a capped `lift`.
 */
export function peakChannel(hue: Rgb, ink: Rgb, glow: number, lift = 0): number {
  let peak = 0;
  for (const [key, rim] of SPHERE) {
    const fragment = { hue, ground: NUMBER_OPS.black, ink, key, rim, presence: 1, glow, lift };
    for (const channel of shadeNode(NUMBER_OPS, fragment)) peak = Math.max(peak, channel);
  }
  return peak;
}
