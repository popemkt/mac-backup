/**
 * The Glass study's shader: sphere tracing a signed distance field, then
 * light through liquid glass. One TSL node graph on one material (T1), drawn
 * on a sphere round the camera, so every pixel is a ray.
 *
 * - **The field.** Each blob is a sphere's distance, `|p − c| − r`, and the
 *   blobs are joined by a smooth minimum: within `blend` of each other two
 *   surfaces bulge together instead of meeting at a crease — metaballs.
 * - **Sphere tracing.** From the eye, step along the ray by the distance the
 *   field reports: no surface can be nearer than that, so the step is always
 *   safe, and near a surface the steps shrink until one lands on it. Rays that
 *   miss the blobs' bounding sphere skip the march entirely.
 * - **The surface.** The normal is the field's gradient, sampled at a
 *   tetrahedron's four corners. Fresnel (Schlick) splits the light: the
 *   reflected part samples the studio in the mirrored direction; the rest
 *   refracts in (Snell), is traced *through* the glass to where it leaves,
 *   and refracts out — once per colour channel, each at its own index, which
 *   is dispersion: the fringes at the edges. What travels far inside is
 *   absorbed (Beer–Lambert), so thick glass is deeper in tint.
 * - **The studio.** What the glass refracts and reflects: a ground falling
 *   to the edge colour, soft light strips (HDR, so they bloom where they
 *   catch) and a faint marbled floor for refraction to bend visibly.
 */
import { BackSide, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector4 } from "three/webgpu";
import {
  Break,
  Fn,
  If,
  abs,
  cameraPosition,
  dot,
  exp,
  float,
  int,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  reflect,
  refract,
  select,
  smoothstep,
  sqrt,
  uniformArray,
  vec3,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import { loop, type TslNode } from "@/scene/gpu/tsl";
import { BLOB_COUNT } from "@/components/lab/glass/blobs";

/** The blobs never leave this sphere round the origin; rays that miss it skip the march. */
const BOUNDS = 3.8;
const OUTER_STEPS = 56;
const INNER_STEPS = 28;
const EPSILON = 0.0015;

export interface GlassUniforms {
  readonly blend: TslNode;
  readonly ior: TslNode;
  readonly dispersion: TslNode;
  readonly density: TslNode;
  /** How far the blobs have grown in, 0–1 each (the entrance). */
  readonly grown: (index: number) => TslNode;
}

/** The blobs' centres and radii, a uniform array the CPU rewrites each frame. */
export function blobUniforms() {
  const values = Array.from({ length: BLOB_COUNT }, () => new Vector4());
  return { values, node: uniformArray(values, "vec4") };
}
type BlobUniforms = ReturnType<typeof blobUniforms>;

/** Polynomial smooth minimum: a crease-free union within `k`. */
function smin(a: TslNode, b: TslNode, k: TslNode): TslNode {
  const h = max(k.sub(abs(a.sub(b))), 0).div(k);
  return min(a, b).sub(h.mul(h).mul(k).mul(0.25));
}

/**
 * The field as one WGSL function (`setLayout`): it is called from a dozen
 * places — the march, both normals, the path through the glass — and inlined
 * at each the shader took most of a minute to compile.
 */
function field(blobs: BlobUniforms, u: GlassUniforms): (p: TslNode) => TslNode {
  const fn = Fn(([p]: readonly [TslNode]) => {
    let d: TslNode = float(1e4);
    for (let i = 0; i < BLOB_COUNT; i++) {
      const blob = blobs.node.element(int(i));
      const sphere = length(p.sub(blob.xyz))
        .sub(blob.w.mul(u.grown(i)))
        .toVar();
      // Each partial union is a variable: smin reads its inputs twice, and
      // left inline the expression would double with every blob (2^7).
      d = smin(d, sphere, u.blend.max(0.01)).toVar();
    }
    return d;
  }).setLayout({ name: "glassField", type: "float", inputs: [{ name: "p", type: "vec3" }] });
  return (p) => fn(p);
}

/** The field's gradient at `p`, from a tetrahedron of four samples. */
function normalAt(sdf: (p: TslNode) => TslNode, p: TslNode): TslNode {
  const e = 0.002;
  const a = vec3(1, -1, -1);
  const b = vec3(-1, -1, 1);
  const c = vec3(-1, 1, -1);
  const d = vec3(1, 1, 1);
  return normalize(
    a
      .mul(sdf(p.add(a.mul(e))))
      .add(b.mul(sdf(p.add(b.mul(e)))))
      .add(c.mul(sdf(p.add(c.mul(e)))))
      .add(d.mul(sdf(p.add(d.mul(e))))),
  );
}

/** The studio, in direction `d`: the light the glass bends and mirrors. */
function studioLight(colors: PaletteUniforms): (d: TslNode) => TslNode {
  const fn = Fn(([d]: readonly [TslNode]) => studioAt(colors, d)).setLayout({
    name: "glassStudio",
    type: "vec3",
    inputs: [{ name: "d", type: "vec3" }],
  });
  return (d) => fn(d);
}

function studioAt(colors: PaletteUniforms, d: TslNode): TslNode {
  const up = d.y;
  const ground = mix(colors.ground, colors.edge, smoothstep(-0.1, 0.9, abs(up)));
  // Soft boxes: a long strip overhead, a key panel to one side, a low rim behind.
  const strip = smoothstep(0.1, 0, abs(up.sub(0.62))).mul(smoothstep(0.75, 0.3, abs(d.x)));
  const key = exp(
    length(d.sub(normalize(vec3(0.75, 0.35, 0.55))))
      .pow(2)
      .mul(-9),
  );
  const rim = exp(
    length(d.sub(normalize(vec3(-0.6, 0.05, -0.8))))
      .pow(2)
      .mul(-14),
  );
  const light = mix(colors.ink, vec3(1, 1, 1), 0.6);
  const lit = light
    .mul(strip.mul(2.4))
    .add(mix(colors.accent, vec3(1, 1, 1), 0.3).mul(key.mul(2.2)))
    .add(mix(colors.hue, colors.ink, 0.5).mul(rim.mul(1.6)));
  // Below the horizon, a marbled floor: something for refraction to bend.
  const floor = smoothstep(0.02, -0.2, up);
  const marble = smoothstep(
    0.35,
    0.65,
    mx_noise_float(d.mul(vec3(6, 2, 6)))
      .mul(0.5)
      .add(0.5),
  );
  const floored = mix(ground, mix(colors.edge, colors.hue, marble.mul(0.25)), floor.mul(0.8));
  // Cards in the ink — dark on a light ground, light on a dark one — so the
  // glass has contrast to bend on either theme: a tall flag to one side and
  // a thin line along the horizon.
  const flag = smoothstep(0.16, 0.06, abs(d.x.add(0.72)))
    .mul(smoothstep(-0.3, 0.1, up))
    .mul(smoothstep(0.8, 0.5, up));
  const horizon = smoothstep(0.035, 0, abs(up.add(0.04)));
  const carded = mix(floored, colors.ink, flag.mul(0.75).add(horizon.mul(0.5)).min(0.85));
  return carded.add(lit);
}

interface Glass {
  readonly colors: PaletteUniforms;
  readonly u: GlassUniforms;
  readonly sdf: (p: TslNode) => TslNode;
  readonly studio: (d: TslNode) => TslNode;
}

/** Where a ray from `p` along `dir` inside the glass leaves it, and how far it went. */
function passThrough(g: Glass, p: TslNode, dir: TslNode) {
  const q = vec3(p).toVar();
  const travelled = float(0).toVar();
  loop(INNER_STEPS, () => {
    const d = g.sdf(q).negate().max(0.02);
    q.addAssign(dir.mul(d));
    travelled.addAssign(d);
    If(g.sdf(q).greaterThan(0), () => {
      Break();
    });
  });
  return { exit: q, travelled };
}

/** The glass's colour where the ray `rd` lands on it at `p`. */
function shade(g: Glass, at: TslNode, rd: TslNode): TslNode {
  const { colors, u, sdf, studio } = g;
  const p = vec3(at).toVar();
  const n = normalAt(sdf, p).toVar();
  const cosine = dot(n, rd.negate()).clamp(0, 1);
  const fresnel = float(0.04).add(float(0.96).mul(float(1).sub(cosine).pow(5)));
  const mirrored = studio(reflect(rd, n));
  // Into the glass, then through it to where it leaves.
  const inward = refract(rd, n, float(1).div(u.ior)).toVar();
  const { exit, travelled } = passThrough(g, p.sub(n.mul(EPSILON * 4)), inward);
  const out = normalAt(sdf, exit).negate();
  const leave = (index: TslNode) => {
    const bent = refract(inward, out, index);
    // Total internal reflection: no way out, so the ray mirrors inside.
    return studio(select(dot(bent, bent).lessThan(0.5), reflect(inward, out), bent));
  };
  const through = vec3(
    leave(u.ior.sub(u.dispersion)).x,
    leave(u.ior).y,
    leave(u.ior.add(u.dispersion)).z,
  );
  const tint = mix(colors.hue, colors.accent, 0.25);
  const absorbed = exp(vec3(1, 1, 1).sub(tint).mul(travelled.mul(u.density)).negate());
  return mix(through.mul(absorbed), mirrored, fresnel);
}

export function glassMesh(colors: PaletteUniforms, blobs: BlobUniforms, u: GlassUniforms): Mesh {
  const sdf = field(blobs, u);
  const studio = studioLight(colors);
  const glass: Glass = { colors, u, sdf, studio };
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  material.fog = false;
  material.colorNode = Fn(() => {
    const ro = vec3(cameraPosition).toVar();
    const rd = normalize(positionWorld.sub(cameraPosition)).toVar();
    const color = studio(rd).toVar();
    // The ray against the bounding sphere: where it enters and leaves.
    const b = dot(ro, rd);
    const h = b.mul(b).sub(dot(ro, ro).sub(BOUNDS * BOUNDS));
    If(h.greaterThan(0), () => {
      const far = b.negate().add(sqrt(h)).toVar();
      const t = max(b.negate().sub(sqrt(h)), 0).toVar();
      const hit = float(0).toVar();
      loop(OUTER_STEPS, () => {
        const d = sdf(ro.add(rd.mul(t)));
        If(d.lessThan(EPSILON), () => {
          hit.assign(1);
          Break();
        });
        t.addAssign(d);
        If(t.greaterThan(far), () => {
          Break();
        });
      });
      If(hit.greaterThan(0.5), () => {
        color.assign(shade(glass, ro.add(rd.mul(t)), rd));
      });
    });
    return color;
  })();
  return new Mesh(new SphereGeometry(60, 48, 32), material);
}
