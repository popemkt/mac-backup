/**
 * The 3D node's light, as numbers (Lab principle L2): the rig baked into the
 * node material, the glow that lifts it past white and the lift that never
 * does. `force3d-nodes` builds its shader from these constants, and `shade`
 * is that shader evaluated on the CPU, so a test can prove which light
 * crosses the bloom threshold (1) and which cannot, for any colour. No three
 * here.
 */

export type Rgb = readonly [number, number, number];

export const NODE_LIGHT = {
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

/** The (key, rim) pairs a visible point of the sphere can see, sampled once. */
const SPHERE: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  const [kx, ky, kz] = KEY_DIRECTION;
  for (let i = 0; i <= 48; i++) {
    for (let j = 0; j <= 96; j++) {
      // A view-space normal on the visible half: z (toward the viewer) >= 0.
      const theta = (i / 48) * (Math.PI / 2);
      const phi = (j / 96) * Math.PI * 2;
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.sin(theta) * Math.sin(phi);
      const nz = Math.cos(theta);
      out.push([Math.max(0, nx * kx + ny * ky + nz * kz), (1 - nz) ** RIM_POWER]);
    }
  }
  return out;
})();

/**
 * One fragment of a fully present node, channel by channel, exactly as the
 * shader in `force3d-nodes` shades it: the rig's light (capped at white — a
 * resting node is matte whatever its colour), plus a `glow` that may pass
 * white, plus a `lift` capped at the fragment's own headroom under white.
 */
function shade(
  hue: Rgb,
  ink: Rgb,
  [key, rim]: readonly [number, number],
  { glow, lift }: { readonly glow: number; readonly lift: number },
): Rgb {
  const L = NODE_LIGHT;
  const light = (c: number) => ((hue[c] ?? 0) * (1 - L.glowWhite) + L.glowWhite) * L.glowGain;
  const glowing = (c: number) =>
    Math.min((hue[c] ?? 0) * (key * L.key + L.fill) + (ink[c] ?? 0) * rim * L.rim, 1) +
    light(c) * glow;
  const room = (c: number) => Math.max(0, 1 - glowing(c)) / light(c);
  const shown = Math.min(lift, room(0), room(1), room(2));
  const out = (c: number) => glowing(c) + light(c) * shown;
  return [out(0), out(1), out(2)];
}

/**
 * The brightest channel a fully present node of linear colour `hue` reaches
 * anywhere on its visible surface, under `ink` (the palette's ink, linear),
 * with a blooming `glow` and a capped `lift`.
 */
export function peakChannel(hue: Rgb, ink: Rgb, glow: number, lift = 0): number {
  let peak = 0;
  const light = { glow, lift };
  for (const point of SPHERE) {
    for (const channel of shade(hue, ink, point, light)) peak = Math.max(peak, channel);
  }
  return peak;
}
