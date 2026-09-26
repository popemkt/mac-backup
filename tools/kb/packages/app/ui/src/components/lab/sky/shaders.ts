/**
 * The sky's shader-drawn pieces: stars with four-point diffraction glints,
 * the nebula, the sun and its corona, and a moon the sun actually lights.
 * Every colour is a palette uniform from the stage (L1); none is typed here.
 */
import {
  AdditiveBlending,
  BackSide,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
} from "three/webgpu";
import {
  abs,
  atan,
  cameraPosition,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_noise_vec3,
  normalize,
  normalWorld,
  positionGeometry,
  positionLocal,
  positionWorld,
  screenUV,
  smoothstep,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import type { TslNode } from "@/scene/gpu/tsl";

/** Position across a sprite's quad: 0 at its centre, ±1 at its edges. */
const quad = () => uv().sub(0.5).mul(2);

/**
 * A star's light at a point of its quad: a tight core, a soft halo, and for a
 * glint two thin crossed spikes — the four-point diffraction of a telescope's
 * vanes. `spikes` scales their length.
 */
export function starLight(glint: TslNode, spikes: TslNode): TslNode {
  const q = quad();
  const ax = q.x.abs();
  const ay = q.y.abs();
  const core = exp(q.dot(q).mul(-55));
  const halo = exp(length(q).mul(-7)).mul(glint.mul(0.5).add(0.18));
  const reach = spikes.max(0.05);
  const arm = (along: TslNode, across: TslNode) =>
    exp(across.mul(-90)).mul(float(1).sub(along.div(reach)).max(0).pow(3));
  return core.add(halo).add(arm(ax, ay).add(arm(ay, ax)).mul(glint));
}

/** The plane the nebula's band lies along, a tilted galactic equator. */
const BAND = [0.28, 0.93, 0.24] as const;

/**
 * The nebula: the dome behind everything, at infinity. Emission is
 * domain-warped fractal noise (one field bends the coordinates of another),
 * concentrated along a band like a galaxy's plane; dark dust lanes, a second
 * warped field, absorb it; a few pockets carry the accent. The ground falls to
 * the edge colour away from the band and at the frame (a subtle vignette), so
 * no part of the sky is a flat fill. `amount` scales the emission.
 *
 * The sun colours the sky round it: a warm aureole toward the sun, and by
 * day (`day` 1) a sky that deepens into the hue away from it, as a clear sky
 * darkens opposite the sun — so the light theme is a lit day, not a blank.
 */
export function nebula(
  colors: PaletteUniforms,
  u: {
    readonly amount: TslNode;
    readonly sun: TslNode;
    readonly day: TslNode;
    readonly arrival: TslNode;
  },
): Mesh {
  const { amount, arrival } = u;
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  material.fog = false;
  const d = normalize(positionLocal);
  const band = exp(
    dot(d, vec3(...BAND))
      .pow(2)
      .mul(-5),
  );
  const warp = mx_noise_vec3(d.mul(1.7)).mul(0.55);
  const q = d.mul(2.4).add(warp);
  const cloud = mx_fractal_noise_float(q, 5, 2.05, 0.55, 1).mul(0.5).add(0.5);
  const glow = smoothstep(0.32, 0.95, cloud).pow(1.3).mul(band.mul(0.85).add(0.15));
  const lanes = smoothstep(
    0.52,
    0.78,
    mx_fractal_noise_float(q.mul(1.9).add(3.7), 4, 2, 0.5, 1).mul(0.5).add(0.5),
  );
  const pockets = smoothstep(0.62, 0.9, mx_noise_float(q.mul(0.8).add(11)).mul(0.5).add(0.5));
  const tint = mix(mix(colors.hue, colors.ink, 0.25), colors.accent, pockets.mul(0.45));
  // Unresolved starlight: a fine, faint grain brightest along the band.
  const grain = smoothstep(0.55, 0.95, mx_noise_float(d.mul(90)).mul(0.5).add(0.5))
    .mul(band)
    .mul(0.12);
  const vignette = smoothstep(0.35, 1.05, length(screenUV.sub(0.5)).mul(1.35));
  const night = mix(mix(colors.edge, colors.ground, band.mul(0.7).add(0.3)), colors.edge, vignette);
  // How far from the sun this direction is: 0 toward it, 2 opposite.
  const off = float(1).sub(dot(d, normalize(u.sun)));
  const aureole = exp(off.mul(-22));
  const away = mix(
    colors.ground,
    mix(colors.hue, colors.edge, 0.35),
    smoothstep(0.02, 0.6, off).mul(0.85),
  );
  const lit = mix(night, away, u.day);
  const ground = mix(
    lit,
    mix(colors.ground, colors.accent, 0.45),
    aureole.mul(mix(float(0.18), float(0.75), u.day)),
  );
  const light = glow
    .mul(float(1).sub(lanes.mul(0.75)))
    .add(grain)
    .mul(amount)
    .mul(arrival);
  material.colorNode = mix(ground, tint, light.min(1));
  return new Mesh(new SphereGeometry(450, 96, 64), material);
}

/** The sun's light: warm white from the accent, and how bright it is (HDR). */
function sunColor(colors: PaletteUniforms): TslNode {
  return mix(colors.accent, vec3(1, 1, 1), 0.62);
}

/**
 * The sun: a sphere whose surface runs past 1 (HDR, so bloom carries it out),
 * limb-darkened — dimmer where the surface turns away — and granulated by a
 * slowly boiling noise.
 */
export function sun(colors: PaletteUniforms, time: TslNode, arrival: TslNode): Mesh {
  const material = new MeshBasicNodeMaterial();
  material.fog = false;
  const view = normalize(cameraPosition.sub(positionWorld));
  const mu = dot(normalWorld, view).clamp(0, 1);
  const cells = mx_fractal_noise_float(
    positionGeometry.mul(7).add(vec3(0, time.mul(0.02), 0)),
    3,
    2,
    0.5,
    1,
  )
    .mul(0.5)
    .add(0.5);
  const limb = mu.pow(0.45);
  const heat = mix(colors.accent, vec3(1, 1, 1), mu.mul(0.35).add(0.35));
  material.colorNode = heat.mul(limb.mul(1.6).add(1.4).add(cells.mul(0.5))).mul(arrival);
  return new Mesh(new SphereGeometry(1, 64, 48), material);
}

/**
 * The corona: a camera-facing glow round the sun, falling off from the limb,
 * broken into faint streamers by noise over the angle round the disc. Drawn
 * additively; the sun's own sphere hides the part behind the disc.
 */
export function corona(colors: PaletteUniforms, time: TslNode, arrival: TslNode): Sprite {
  const material = new SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  material.fog = false;
  const q = quad();
  const d = length(q);
  const angle = atan(q.y, q.x);
  const streamers = mx_noise_float(vec2(angle.mul(4), time.mul(0.03)))
    .mul(0.5)
    .add(0.5);
  const fall = exp(d.sub(0.11).max(0).mul(-9)).mul(streamers.mul(0.7).add(0.5));
  const haze = exp(d.mul(-4)).mul(0.16);
  material.colorNode = sunColor(colors).mul(0.9);
  material.opacityNode = fall
    .add(haze)
    .mul(float(1).sub(smoothstep(0.85, 1, d)))
    .mul(arrival);
  return new Sprite(material);
}

/**
 * The moon, lit by the sun wherever the two stand. The light is the sun's
 * direction from each point of the surface, so the terminator — the line
 * between day and night on the moon — and with it the phase follow the two
 * bodies as they move: the moon is full with the sun behind the viewer, new
 * with the sun behind the moon. The terminator is sharp (no atmosphere to
 * soften it), rough highlands and dark maria are noise on the surface, and
 * the night side keeps a faint earthshine: light the viewer's world throws
 * back. `day` (1 on a light theme) lets the sky through the unlit side, as a
 * daytime moon does.
 */
export function moon(
  colors: PaletteUniforms,
  u: {
    readonly sun: TslNode;
    readonly earthshine: TslNode;
    readonly day: TslNode;
    readonly arrival: TslNode;
  },
): Mesh {
  const material = new MeshBasicNodeMaterial({ transparent: true });
  material.fog = false;
  const q = positionGeometry;
  const rough = mx_noise_vec3(q.mul(9))
    .mul(0.09)
    .add(mx_noise_vec3(q.mul(23)).mul(0.035));
  const n = normalize(normalWorld.add(rough));
  const toSun = normalize(u.sun.sub(positionWorld));
  const view = normalize(cameraPosition.sub(positionWorld));
  const ndl = dot(n, toSun);
  const lit = smoothstep(-0.02, 0.09, ndl).mul(max(ndl, 0).pow(0.6));
  const maria = smoothstep(
    0.45,
    0.7,
    mx_fractal_noise_float(q.mul(1.4), 4, 2, 0.5, 1).mul(0.5).add(0.5),
  );
  const craters = abs(mx_noise_float(q.mul(11)))
    .pow(0.8)
    .mul(0.1);
  // Always the lighter of ground and ink: a pale moon on either theme.
  const pale = max(colors.ink, colors.ground);
  const albedo = pale.mul(float(0.82).sub(maria.mul(0.32)).add(craters));
  const shine = dot(n, view).max(0).mul(u.earthshine);
  const day = albedo.mul(sunColor(colors)).mul(lit.mul(1.05));
  const night = albedo.mul(mix(colors.hue, colors.ink, 0.5)).mul(shine.mul(2));
  material.colorNode = day.add(night);
  const seen = lit.add(shine.mul(3)).min(1);
  material.opacityNode = mix(float(1), seen, u.day).mul(u.arrival);
  return new Mesh(new SphereGeometry(1, 96, 64), material);
}
