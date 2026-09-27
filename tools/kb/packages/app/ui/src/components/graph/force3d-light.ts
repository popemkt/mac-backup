/**
 * The 3D node's light, as numbers (Lab principle L2): the rig baked into the
 * node material, the glow that lifts it past white and the lift that never
 * does, written once (`shadeNode`) over the scene kit's shading arithmetic:
 * `force3d-nodes` runs it as TSL nodes, a test runs it as numbers, so the
 * test proves which light crosses the bloom threshold (1) for any colour of
 * the shader itself. No three here.
 *
 * A node's **surface** is how it takes the rig — matte, cel, fresnel,
 * glass — and it is its theme's (`graph-themes`), data a perspective chooses
 * (`lens.theme`). A surface changes only the surface light; the rest cap,
 * the glow and the lift cap are the one `shadeNode` every surface runs
 * through, so the bloom rule — only focus, hover, a search match and a hub
 * cross 1, and nothing in a theme without bloom — holds for every theme by
 * construction, and `force3d-light.test.ts` proves it over every theme,
 * colour and design system.
 */

import { NUMBER_OPS, type Rgb, type ShadeOps } from "@/scene/shade-ops";
import type { NodeForm } from "./graph-themes";

export type { Rgb };

const NODE_LIGHT = {
  /** How far past white a fully glowing node's colour goes. */
  glowGain: 2.4,
  /** How far a glowing node's light whitens toward its core. */
  glowWhite: 0.25,
} as const;

/** How a node's surface takes the light; a theme names one (`graph-themes`). */
export type NodeSurface = "matte" | "cel" | "fresnel" | "glass" | "flat";

/**
 * Each surface's light, before the shared caps. Every one must grow
 * with the key (never dim where the key is stronger) and depend on the view
 * only through the rim: that is what lets `peakChannel` find a sphere's
 * brightest fragment ring by ring.
 */
const SURFACES: Record<NodeSurface, <V, S>(o: ShadeOps<V, S>, f: NodeFragment<V, S>) => V> = {
  // A soft key from the upper left, a fill that keeps the dark side in the
  // node's own colour, and an ink rim that draws the silhouette.
  matte: (o, f) =>
    o.addColor(
      o.scale(f.hue, o.add(o.mul(f.key, o.num(0.5)), o.num(0.42))),
      o.scale(f.ink, o.mul(f.rim, o.num(0.16))),
    ),
  // Cel: the key in three flat bands, under a hard ink outline drawn over
  // the silhouette (a mix toward the ink, so it reads on a light ground too).
  cel: (o, f) =>
    o.mix(
      o.scale(f.hue, o.add(o.mul(o.band(f.key, 3), o.num(0.6)), o.num(0.36))),
      f.ink,
      o.mul(o.smoothstep(0.2, 0.26, f.rim), o.num(0.9)),
    ),
  // Fresnel: a quiet body and a rim that brightens toward the ink, as a
  // holographic shell does at grazing angles.
  fresnel: (o, f) =>
    o.addColor(
      o.scale(f.hue, o.add(o.mul(f.key, o.num(0.22)), o.num(0.2))),
      o.scale(o.mix(f.hue, f.ink, o.num(0.45)), o.mul(o.smoothstep(0, 0.6, f.rim), o.num(1.1))),
    ),
  // Flat: the colour as painted, whatever the light (the bullet theme's).
  flat: (_o, f) => f.hue,
  // Glass, refraction-lite: the ground seen through a tinted body, a tight
  // specular glint from the key, and a thin ink edge where the glass turns
  // away (a mix toward the ink, so the bead has an edge on a light ground).
  glass: (o, f) =>
    o.mix(
      o.addColor(
        o.scale(o.mix(f.ground, f.hue, o.num(0.6)), o.add(o.mul(f.key, o.num(0.25)), o.num(0.55))),
        o.scale(o.white, o.mul(o.pow(f.key, 28), o.num(0.9))),
      ),
      f.ink,
      o.mul(f.rim, o.num(0.4)),
    ),
};

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
 * 0. Every surface's light grows with the key, so a ring's brightest
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

/**
 * The (key, rim) pairs a cube's visible fragments can see, sampled over the
 * whole square: a face may face the key squarely while its edge line is
 * fully drawn, so every key meets every rim. A superset of what any
 * attitude shows, so a peak found here bounds the drawn one.
 */
const STEPS = 16;
const CUBE: readonly (readonly [number, number])[] = Array.from(
  { length: (STEPS + 1) ** 2 },
  (_, i): [number, number] => [Math.floor(i / (STEPS + 1)) / STEPS, (i % (STEPS + 1)) / STEPS],
);

/**
 * Where each form's fragments stand in (key, rim): a sphere's rings, a
 * cube's full square, and a bullet's one flat fragment — the sprite is lit
 * with the key full on and no rim (`force3d-bullets`).
 */
const FRAGMENTS: Record<NodeForm, readonly (readonly [number, number])[]> = {
  sphere: SPHERE,
  cube: CUBE,
  bullet: [[1, 0]],
};

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
 * what the shader draws. The surface light is capped at white (a resting
 * node never blooms, whatever its colour or surface), a `glow` is added on
 * top and may pass white, and a `lift` is capped at the fragment's own
 * headroom under white, channel by channel, so it never does. Where the
 * theme does not bloom (`glows` false) the glow is taken as lift: it still
 * brightens, and never passes white.
 */
export function shadeNode<V, S>(
  o: ShadeOps<V, S>,
  f: NodeFragment<V, S>,
  surface: NodeSurface = "matte",
  glows = true,
): V {
  const L = NODE_LIGHT;
  const lit = SURFACES[surface](o, f);
  const rest = o.minColor(o.mix(f.ground, lit, f.presence), o.white);
  const light = o.scale(o.mix(f.hue, o.white, o.num(L.glowWhite)), o.num(L.glowGain));
  const glowing = glows ? o.addColor(rest, o.scale(light, f.glow)) : rest;
  const lift = glows ? f.lift : o.add(f.lift, f.glow);
  const room = o.divColor(o.maxColor(o.subColor(o.white, glowing), o.black), light);
  return o.addColor(glowing, o.scale(light, o.min(lift, o.minChannel(room))));
}

/**
 * The light a node is shaded under: what it is drawn as, its surface,
 * whether it may bloom, the palette's ink and ground (linear).
 */
export interface NodeLighting {
  readonly form: NodeForm;
  readonly surface: NodeSurface;
  readonly glows: boolean;
  readonly ink: Rgb;
  readonly ground: Rgb;
}

/**
 * The brightest channel a fully present node of linear colour `hue` reaches
 * anywhere on its visible surface (as its form shows it), under `lighting`, with a blooming `glow`
 * and a capped `lift`.
 */
export function peakChannel(hue: Rgb, lighting: NodeLighting, glow: number, lift = 0): number {
  const { form, surface, glows, ink, ground } = lighting;
  let peak = 0;
  for (const [key, rim] of FRAGMENTS[form]) {
    const fragment = { hue, ground, ink, key, rim, presence: 1, glow, lift };
    for (const channel of shadeNode(NUMBER_OPS, fragment, surface, glows))
      peak = Math.max(peak, channel);
  }
  return peak;
}
