/**
 * The Ocean's shaders: one sky, and a sea that displaces, lights and fades
 * into it.
 *
 * - **The sky is one function** (`skyFunction`, one WGSL function by `setLayout`),
 *   read three ways: by the dome behind everything, by the sea's reflections,
 *   and by the sea's distance fade. The horizon the water melts into is the
 *   horizon the sky draws, so they can never disagree.
 * - **The sea** displaces a grid by the Gerstner sum in the vertex stage and
 *   carries the analytic normal (the cross of the summed tangent and
 *   binormal) and a foam mask (where the surface's Jacobian pinches, as at a
 *   breaking crest) to the fragment. There: Fresnel (Schlick) mixes the deep
 *   body with the reflected sky; light passing through thin crests toward the
 *   sun glows in the accent (a subsurface cheat); a tight sun glint runs past
 *   1, so the glitter path blooms (L2); distance fades into the sky's
 *   horizon behind it (L3).
 */
import {
  BackSide,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector4,
} from "three/webgpu";
import {
  Fn,
  abs,
  cameraPosition,
  cos,
  cross,
  dot,
  exp,
  float,
  int,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  uniformArray,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import type { TslNode } from "@/scene/gpu/tsl";
import { WAVE_COUNT, type Wave } from "@/components/lab/ocean/waves";

export interface SeaUniforms {
  readonly time: TslNode;
  /** Unit direction toward the sun. */
  readonly sun: TslNode;
  /** 0–1: how far the waves have risen from calm (the entrance). */
  readonly swell: TslNode;
  readonly foam: TslNode;
}

/** The wave set as two uniform arrays: (dx, dz, k, a) and (c, s, 0, 0). */
export function waveUniforms() {
  const shape = Array.from({ length: WAVE_COUNT }, () => new Vector4());
  const motion = Array.from({ length: WAVE_COUNT }, () => new Vector4());
  return {
    shape: uniformArray(shape, "vec4"),
    motion: uniformArray(motion, "vec4"),
    set: (waves: readonly Wave[]) => {
      waves.forEach((w, i) => {
        shape[i]?.set(w.dx, w.dz, w.k, w.amplitude);
        motion[i]?.set(w.speed, w.steepness, 0, 0);
      });
    },
  };
}
type WaveUniforms = ReturnType<typeof waveUniforms>;

/** The sun's own light: the accent run toward white. */
function sunlight(colors: PaletteUniforms): TslNode {
  return mix(colors.accent, vec3(1, 1, 1), 0.55);
}

/**
 * The sky in direction `d`, as a WGSL function its readers call. A material
 * takes its own instance: a layout function's uniforms are bound per
 * material, and one instance shared by two left the second unbound.
 */
export function skyFunction(colors: PaletteUniforms, u: SeaUniforms): (d: TslNode) => TslNode {
  const fn = Fn(([d]: readonly [TslNode]) => {
    const up = d.y;
    const mu = dot(d, u.sun).max(0);
    // The hue family everywhere; the accent only where the sun warms it (L1).
    const horizon = mix(colors.ground, mix(colors.hue, colors.ink, 0.3), 0.3);
    const zenith = mix(colors.edge, colors.hue, 0.28);
    const base = mix(horizon, zenith, pow(up.clamp(0, 1), 0.45));
    // Warmth pooled along the horizon under the sun, a wide glow and a tight one.
    const band = exp(abs(up).mul(-14)).mul(mu.pow(3).mul(0.9).add(0.05)).mul(0.5);
    const glow = pow(mu, 24).mul(0.3).add(pow(mu, 400).mul(1.2));
    const disc = smoothstep(0.99975, 0.99988, mu).mul(14);
    const lit = base.add(colors.accent.mul(band)).add(sunlight(colors).mul(glow.add(disc)));
    // A stratus layer, projected on a plane overhead, lit from below by the sun.
    const reach = up.max(0.02);
    const plane = vec2(d.x, d.z)
      .div(reach)
      .mul(0.35)
      .add(vec2(u.time.mul(0.004), 0));
    const cloud = smoothstep(
      0.42,
      0.92,
      mx_fractal_noise_float(vec3(plane.x, plane.y.mul(2.6), 1.7), 5, 2, 0.5, 1)
        .mul(0.5)
        .add(0.5),
    );
    const edgeLit = mix(
      mix(colors.edge, colors.hue, 0.3).mul(0.7),
      sunlight(colors).mul(1.3),
      pow(mu, 3),
    );
    const cloudy = mix(lit, edgeLit, cloud.mul(smoothstep(0.01, 0.12, up)).mul(0.7));
    // Below the horizon only reflections look; give them the horizon, dimmed.
    return mix(cloudy, horizon.mul(0.6), smoothstep(0, -0.08, up));
  }).setLayout({ name: "oceanSky", type: "vec3", inputs: [{ name: "d", type: "vec3" }] });
  return (d) => fn(d);
}

export function skyDome(sky: (d: TslNode) => TslNode): Mesh {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  material.fog = false;
  material.colorNode = sky(normalize(positionWorld.sub(cameraPosition)));
  return new Mesh(new SphereGeometry(500, 48, 32), material);
}

/** The Gerstner sum at grid point `p` (xz): displaced position, normal and pinch. */
function gerstner(w: WaveUniforms, u: SeaUniforms, p: TslNode) {
  let offset: TslNode = vec3(0, 0, 0);
  let tangent: TslNode = vec3(1, 0, 0);
  let binormal: TslNode = vec3(0, 0, 1);
  for (let i = 0; i < WAVE_COUNT; i++) {
    const shape = w.shape.element(int(i));
    const motion = w.motion.element(int(i));
    const d = shape.xy;
    const s = motion.y.mul(u.swell);
    const a = shape.w.mul(u.swell);
    const f = shape.z.mul(dot(d, p.xz).sub(motion.x.mul(u.time))).toVar();
    const sf = sin(f).toVar();
    const cf = cos(f).toVar();
    offset = offset.add(vec3(d.x.mul(a).mul(cf), a.mul(sf), d.y.mul(a).mul(cf))).toVar();
    tangent = tangent
      .add(
        vec3(
          d.x.mul(d.x).mul(s).mul(sf).negate(),
          d.x.mul(s).mul(cf),
          d.x.mul(d.y).mul(s).mul(sf).negate(),
        ),
      )
      .toVar();
    binormal = binormal
      .add(
        vec3(
          d.x.mul(d.y).mul(s).mul(sf).negate(),
          d.y.mul(s).mul(cf),
          d.y.mul(d.y).mul(s).mul(sf).negate(),
        ),
      )
      .toVar();
  }
  const normal = normalize(cross(binormal, tangent));
  // The surface's area change: below 1 the grid is squeezed, as a crest pinches.
  const jacobian = tangent.x.mul(binormal.z).sub(tangent.z.mul(binormal.x));
  return { position: p.add(offset), normal, jacobian };
}

export function sea(
  colors: PaletteUniforms,
  sky: (d: TslNode) => TslNode,
  w: WaveUniforms,
  u: SeaUniforms,
): Mesh {
  const geometry = new PlaneGeometry(240, 240, 480, 480);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicNodeMaterial();
  material.fog = false;
  const wave = gerstner(w, u, positionLocal);
  material.positionNode = wave.position;
  const normal = varying(wave.normal, "vSeaNormal");
  const pinch = varying(wave.jacobian, "vSeaPinch");
  const height = varying(wave.position.y, "vSeaHeight");
  material.colorNode = Fn(() => {
    const n = normalize(normal).toVar();
    const toEye = cameraPosition.sub(positionWorld);
    const v = normalize(toEye).toVar();
    const r = reflect(v.negate(), n);
    const mirrored = sky(vec3(r.x, abs(r.y), r.z)).mul(0.82);
    const facing = dot(n, v).clamp(0, 1);
    const fresnel = float(0.02).add(float(0.98).mul(float(1).sub(facing).pow(5)));
    const deep = mix(colors.edge, colors.hue, 0.3).mul(0.18);
    // Light through thin crests toward the sun: a warm glow on the back of waves.
    const back = pow(dot(v, vec3(u.sun.x, 0, u.sun.z).normalize().negate()).max(0), 3);
    const through = colors.accent
      .mul(0.35)
      .mul(back)
      .mul(smoothstep(-0.1, 0.9, height));
    const glint = pow(max(dot(r, u.sun), 0), 2200).mul(22);
    // Foam only where a crest truly pinches, broken into lace by fine noise.
    const lace = mx_fractal_noise_float(positionWorld.mul(vec3(2.2, 4, 2.2)), 3, 2, 0.5, 1)
      .mul(0.5)
      .add(0.5);
    const foamy = smoothstep(0.42, 0.18, pinch)
      .mul(smoothstep(0.45, 0.75, lace))
      .mul(smoothstep(0.1, 0.6, height))
      .mul(u.foam);
    const water = mix(deep.add(through), mirrored, fresnel).add(sunlight(colors).mul(glint));
    const foamed = mix(water, max(colors.ink, colors.ground).mul(0.85), foamy.mul(0.7));
    // Far water fades into the very horizon the sky draws behind it.
    const along = normalize(vec3(v.x.negate(), 0.01, v.z.negate()));
    const haze = float(1).sub(exp(length(toEye).mul(-0.014)));
    return mix(foamed, sky(along), haze);
  })();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
