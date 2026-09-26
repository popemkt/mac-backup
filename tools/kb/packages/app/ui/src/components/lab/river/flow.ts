/**
 * The River's flow, on the GPU: one TSL compute kernel over two storage
 * buffers advects 131 072 particles a frame (T1); nothing reads back.
 *
 * - **Curl noise.** The flow is the curl of a smooth noise potential
 *   (∇ × ψ). A curl has no divergence, so the field never piles particles
 *   up or thins them out: it only swirls — eddies that look like water
 *   because, like an incompressible fluid, nothing is created or lost. The
 *   curl's six partial derivatives are central differences of ψ.
 * - **A river.** A steady current carries everything downstream along a
 *   meandering channel, and a pull toward the channel's centre line keeps
 *   the swirl inside its banks. The pointer adds a vortex round itself.
 * - **Inertia.** A particle's velocity approaches the field's on a
 *   frame-rate-independent exponential (M1), so it drifts into an eddy
 *   rather than snapping to it.
 * - **Recycling.** A particle past the mouth, or past its lifetime, is
 *   reborn at the source, somewhere on the channel's cross-section.
 */
import {
  Fn,
  If,
  cos,
  cross,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  length,
  mix,
  mx_noise_vec3,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { Vector3 } from "three/webgpu";
import type { TslNode } from "@/scene/gpu/tsl";
import { seededRandom } from "@/components/lab/kit/seeded";

export const PARTICLES = 131_072;
/** The river runs along x from -LENGTH to +LENGTH, world units. */
const LENGTH = 13;
const RADIUS = 1.35;

/** The channel's centre line at `x`: a slow meander in y and z. */
function centreAt(x: TslNode): TslNode {
  return vec3(x, sin(x.mul(0.33)).mul(1.3), cos(x.mul(0.21)).mul(1.4));
}

function centreNumbers(x: number): [number, number, number] {
  return [x, Math.sin(x * 0.33) * 1.3, Math.cos(x * 0.21) * 1.4];
}

function flowUniforms() {
  return {
    dt: uniform(0),
    time: uniform(0),
    speed: uniform(1),
    scale: uniform(0.45),
    turbulence: uniform(1),
    /** The pointer on the plane facing the camera, and the axis it swirls round. */
    pointer: uniform(new Vector3(0, 0, 1000)),
    axis: uniform(new Vector3(0, 0, 1)),
  };
}
type FlowUniforms = ReturnType<typeof flowUniforms>;

/** Particles strewn along the whole river, so the first frame is already a river. */
function seed() {
  const random = seededRandom(0x51ed270b);
  const positions = new Float32Array(PARTICLES * 4);
  const velocities = new Float32Array(PARTICLES * 4);
  for (let i = 0; i < PARTICLES; i++) {
    const x = (random() * 2 - 1) * LENGTH;
    const [cx, cy, cz] = centreNumbers(x);
    const angle = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * RADIUS;
    positions.set([cx, cy + Math.cos(angle) * r, cz + Math.sin(angle) * r, random() * 6], i * 4);
    velocities.set([0, 0, 0, 5 + random() * 5], i * 4);
  }
  return {
    /** xyz: where; w: age (s). */
    position: instancedArray(positions, "vec4"),
    /** xyz: velocity; w: lifetime (s). */
    velocity: instancedArray(velocities, "vec4"),
  };
}
export type FlowBuffers = ReturnType<typeof seed>;

/** The noise potential ψ, as one WGSL function (it is sampled six times a particle). */
const potential = Fn(([q]: readonly [TslNode]) => mx_noise_vec3(q)).setLayout({
  name: "riverPotential",
  type: "vec3",
  inputs: [{ name: "q", type: "vec3" }],
});

/** ∇ × ψ at `q`, by central differences. */
function curl(q: TslNode): TslNode {
  const e = 0.08;
  const dx = vec3(e, 0, 0);
  const dy = vec3(0, e, 0);
  const dz = vec3(0, 0, e);
  const px0 = potential(q.sub(dx));
  const px1 = potential(q.add(dx));
  const py0 = potential(q.sub(dy));
  const py1 = potential(q.add(dy));
  const pz0 = potential(q.sub(dz));
  const pz1 = potential(q.add(dz));
  return vec3(
    py1.z.sub(py0.z).sub(pz1.y.sub(pz0.y)),
    pz1.x.sub(pz0.x).sub(px1.z.sub(px0.z)),
    px1.y.sub(px0.y).sub(py1.x.sub(py0.x)),
  ).div(2 * e);
}

function advect(u: FlowUniforms, b: FlowBuffers) {
  return Fn(() => {
    const i = instanceIndex;
    const state = b.position.element(i);
    const motion = b.velocity.element(i);
    const p = state.xyz.toVar();
    const age = state.w.add(u.dt).toVar();
    // The field slowly evolves: the potential is sampled drifting downstream.
    const q = p.mul(u.scale).add(vec3(u.time.mul(-0.05), 0, u.time.mul(0.03)));
    const swirl = curl(q).mul(u.turbulence.mul(1.6));
    const centre = centreAt(p.x);
    const off = p.sub(centre).mul(vec3(0, 1, 1));
    const banks = off.mul(smoothstep(RADIUS * 0.6, RADIUS * 1.6, length(off)).mul(-2.5));
    const current = vec3(u.speed.mul(1.4), 0, 0);
    const around = p.sub(u.pointer);
    const near = exp(length(around).mul(length(around)).mul(-0.35));
    const vortex = cross(u.axis, around).mul(near.mul(4.5));
    const target = current
      .add(swirl.mul(u.speed.max(0.35)))
      .add(banks)
      .add(vortex);
    const v = mix(target, motion.xyz, exp(u.dt.mul(-3))).toVar();
    p.addAssign(v.mul(u.dt));
    If(p.x.greaterThan(LENGTH).or(age.greaterThan(motion.w)), () => {
      // Reborn at the source, somewhere on the channel's cross-section.
      const seedAt = float(i).add(u.time.mul(97.13));
      const angle = hash(seedAt).mul(Math.PI * 2);
      const r = hash(seedAt.add(3.7)).sqrt().mul(RADIUS);
      const x = hash(seedAt.add(9.1)).mul(2).sub(LENGTH);
      const at = centreAt(x);
      p.assign(vec3(at.x, at.y.add(cos(angle).mul(r)), at.z.add(sin(angle).mul(r))));
      v.assign(current);
      age.assign(0);
    });
    state.assign(vec4(p, age));
    motion.assign(vec4(v, motion.w));
  })().compute(PARTICLES);
}

export function riverFlow() {
  const u = flowUniforms();
  const buffers = seed();
  return { u, buffers, pass: advect(u, buffers) };
}
