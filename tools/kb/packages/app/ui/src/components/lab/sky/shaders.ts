/**
 * The sky's shader-drawn pieces: stars with four-point diffraction glints,
 * the nebula dome, and the sun and moon. Every colour is a palette uniform
 * from the stage (L1); none is typed here.
 */
import {
  BackSide,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
} from "three/webgpu";
import {
  exp,
  float,
  length,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  positionLocal,
  screenUV,
  smoothstep,
  sqrt,
  uv,
  vec3,
  type uniform,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";

type FloatNode = ReturnType<typeof float>;
type FloatUniform = ReturnType<typeof uniform<number>>;

/** Position across a sprite's quad: 0 at its centre, ±1 at its edges. */
const quad = () => uv().sub(0.5).mul(2);

/**
 * A star's light at a point of its quad: a tight core, a soft halo, and for a
 * glint two thin crossed spikes — the four-point diffraction of a telescope's
 * vanes. `spikes` scales their length.
 */
export function starLight(glint: FloatNode, spikes: FloatUniform) {
  const q = quad();
  const ax = q.x.abs();
  const ay = q.y.abs();
  const core = exp(q.dot(q).mul(-55));
  const halo = exp(length(q).mul(-7)).mul(glint.mul(0.5).add(0.18));
  const reach = spikes.max(0.05);
  const arm = (along: FloatNode, across: FloatNode) =>
    exp(across.mul(-90)).mul(float(1).sub(along.div(reach)).max(0).pow(3));
  return core.add(halo).add(arm(ax, ay).add(arm(ay, ax)).mul(glint));
}

/**
 * The dome behind everything: ground at the focal point, falling to the edge
 * colour at the frame (a subtle vignette), under a nebula haze. The haze is
 * six octaves of noise at a gentle contrast — fine structure, soft falloff —
 * and a second, slower field shades it between two nearby hues: the hue, and
 * the hue lifted toward the ink.
 */
export function dome(colors: PaletteUniforms, nebula: FloatUniform): Mesh {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  const direction = normalize(positionLocal);
  const cloud = mx_fractal_noise_float(direction.mul(3.2), 6, 2.1, 0.55, 1).mul(0.5).add(0.5);
  const wisps = smoothstep(0.3, 1.05, cloud).pow(1.4);
  const shade = smoothstep(0.2, 0.8, mx_noise_float(direction.mul(1.3)).mul(0.5).add(0.5));
  const tint = mix(colors.hue, mix(colors.hue, colors.ink, 0.3), shade);
  const vignette = smoothstep(0.35, 1, length(screenUV.sub(0.5)).mul(1.35));
  const base = mix(colors.ground, colors.edge, vignette);
  material.colorNode = mix(base, tint, wisps.mul(nebula).mul(0.8).add(vignette.mul(0.18)));
  return new Mesh(new SphereGeometry(120, 64, 48), material);
}

/** The sun: a limb-darkened HDR disc under a corona that bloom carries out (L2). */
export function sun(colors: PaletteUniforms, strength: FloatUniform): Sprite {
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const d = length(quad());
  const disc = float(1).sub(smoothstep(0.34, 0.36, d));
  const limb = sqrt(float(1).sub(d.div(0.36).min(1).pow(2)));
  const corona = exp(d.sub(0.34).max(0).mul(-6.5)).mul(float(1).sub(disc));
  // The disc runs past 1 (HDR), so bloom carries its corona out; nothing else in the sky does.
  material.colorNode = colors.accent.mul(disc.mul(limb.mul(0.8).add(2.2)).add(corona.mul(1.6)));
  material.opacityNode = disc.add(corona.mul(0.85)).min(1).mul(strength);
  return new Sprite(material);
}

/** The moon: a gibbous sphere lit from the upper left, with faint maria. */
export function moon(colors: PaletteUniforms, strength: FloatUniform): Sprite {
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const q = quad().div(0.3);
  const d = length(q);
  const disc = float(1).sub(smoothstep(0.96, 1, d));
  const normal = vec3(q.x, q.y, sqrt(float(1).sub(d.min(1).pow(2))));
  const lit = smoothstep(-0.05, 0.3, normal.dot(normalize(vec3(-0.75, 0.4, 0.55))));
  const maria = mx_fractal_noise_float(vec3(q.mul(1.6), 3.1), 3, 2, 0.5, 1)
    .mul(0.14)
    .add(0.9);
  const halo = exp(d.sub(1).max(0).mul(-1.4)).mul(0.36).mul(float(1).sub(disc));
  material.colorNode = colors.ink.mul(disc.mul(lit.mul(maria).mul(1.15).add(0.07)).add(halo));
  material.opacityNode = disc.add(halo).min(1).mul(strength);
  return new Sprite(material);
}
