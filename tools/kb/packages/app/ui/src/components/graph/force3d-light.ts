/**
 * The 3D node's light, as numbers (Lab principle L2): the rig baked into the
 * node material and the glow that lifts it past white. `force3d-nodes` builds
 * its shader from these constants, and `peakChannel` bounds what that shader
 * can output, so a test can prove which glow crosses the bloom threshold (1)
 * and which cannot. No three here.
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
 * The brightest channel a fully present node of linear colour `hue` reaches
 * with `glow`, anywhere on its visible surface, under `ink` (the palette's
 * ink, linear): the shader in `force3d-nodes`, evaluated on the CPU over the
 * visible hemisphere.
 */
export function peakChannel(hue: Rgb, ink: Rgb, glow: number): number {
  const L = NODE_LIGHT;
  let peak = 0;
  for (let c = 0; c < 3; c++) {
    const h = hue[c] ?? 0;
    const light = (h * (1 - L.glowWhite) + L.glowWhite) * glow * L.glowGain;
    for (const [key, rim] of SPHERE) {
      peak = Math.max(peak, h * (key * L.key + L.fill) + (ink[c] ?? 0) * rim * L.rim + light);
    }
  }
  return peak;
}

/** The most glow `hue` can take under `ink` and still stay at or under 1 everywhere. */
export function glowHeadroom(hue: Rgb, ink: Rgb): number {
  const L = NODE_LIGHT;
  let room = Infinity;
  for (let c = 0; c < 3; c++) {
    const h = hue[c] ?? 0;
    let lit = 0;
    for (const [key, rim] of SPHERE)
      lit = Math.max(lit, h * (key * L.key + L.fill) + (ink[c] ?? 0) * rim * L.rim);
    room = Math.min(
      room,
      Math.max(0, 1 - lit) / ((h * (1 - L.glowWhite) + L.glowWhite) * L.glowGain),
    );
  }
  return room;
}
