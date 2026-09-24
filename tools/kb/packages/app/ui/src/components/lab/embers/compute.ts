/**
 * The Embers simulation, on the GPU: TSL compute kernels over storage
 * buffers, four dispatches a frame (Lab principle T1).
 *
 * 1. `clear`   — empty the spatial hash grid (and the frame's pop tickets).
 * 2. `insert`  — every live sphere claims a slot in its cell (an atomic add).
 * 3. `collide` — every sphere scans the 27 cells round it and sums, for
 *    itself only, how far it must move out of its neighbours, the bounce, and
 *    the heat of the impacts. Reading others and writing only itself keeps
 *    the pass race-free.
 * 4. `advance` — springs home in a slowly turning ball (critically damped,
 *    M1), the pointer's shove, the collision results, cooling, and the pop
 *    and regrowth phases; the scale ease is `--motion-settle` (M6).
 *
 * A sphere at the pop threshold asks for a ticket; the CPU grants at most one
 * per frame and rarely (`PopGrants`), so pops are crisp and never a barrage
 * (M4). A sphere without a ticket waits at the threshold, hot.
 */
import {
  Fn,
  If,
  atomicAdd,
  atomicLoad,
  atomicStore,
  cos,
  dot,
  exp,
  float,
  floor,
  instanceIndex,
  instancedArray,
  int,
  ivec3,
  length,
  mix,
  mx_noise_float,
  normalize,
  sin,
  smoothstep,
  uint,
  uniform,
  uvec2,
  vec3,
} from "three/tsl";
import { Vector3 } from "three/webgpu";
import { easeNode, loop, type TslNode } from "@/scene/gpu/tsl";
import type { Timing } from "@/lib/timing";

/** Grid table size (power of two) and how many spheres one cell remembers. */
const TABLE = 16384;
const SLOTS = 8;
const LIVE = 0;
const POPPING = 1;
const GROWING = 2;
/** Peak scale of a pop's pulse, and how long the shrink after it takes. */
const POP_SWELL = 1.4;
const POP_SHRINK = 0.12;
/** The fastest pointer speed (world units/s) the force field responds to. */
const MAX_SHOVE_SPEED = 14;

export interface EmberShape {
  readonly count: number;
  readonly sphere: number;
  readonly cloud: number;
}

/** The uniforms the CPU drives; the info card's sliders set three of them. */
function emberUniforms() {
  return {
    center: uniform(new Vector3()),
    pointer: uniform(new Vector3(0, 0, 100)),
    pointerVelocity: uniform(new Vector3()),
    dt: uniform(0),
    time: uniform(0),
    gain: uniform(0.6),
    cooling: uniform(0.9),
    threshold: uniform(1),
    /** Pops this frame may start: 0 or 1, from `PopGrants`. */
    grant: uniform(0),
  };
}
export type EmberUniforms = ReturnType<typeof emberUniforms>;

/**
 * The storage buffers. A WebGPU stage may bind 8, so what travels together
 * is packed together: a sphere's phase, clock, scale and glow are one vec4,
 * and the collision pass's two results share one buffer.
 */
function buffers(homes: Float32Array, count: number) {
  const state = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) state[i * 4 + 2] = 1;
  return {
    home: instancedArray(homes, "vec3"),
    position: instancedArray(homes.slice(), "vec3"),
    velocity: instancedArray(count, "vec3"),
    heat: instancedArray(count, "float"),
    /** x: phase (live, popping, growing); y: seconds in it; z: scale; w: glow (0…1, a flash past it). */
    state: instancedArray(state, "vec4"),
    /** `[i]`: how far to move out of the neighbours; `[count + i]`: the bounce. */
    contact: instancedArray(count * 2, "vec3"),
    cells: instancedArray(TABLE, "uint").toAtomic(),
    /** x: the sphere; y: its cell's exact key, so a hash collision is told apart. */
    slots: instancedArray(TABLE * SLOTS, "uvec2"),
    tickets: instancedArray(1, "uint").toAtomic(),
  };
}
export type EmberBuffers = ReturnType<typeof buffers>;

/** The grid cell of an integer cell coordinate, hashed into the table. */
function hashCell(c: TslNode): TslNode {
  return c.x
    .mul(73856093)
    .bitXor(c.y.mul(19349663))
    .bitXor(c.z.mul(83492791))
    .bitAnd(TABLE - 1)
    .toUint();
}

/**
 * A cell's exact identity: its coordinates packed ten bits each. The cloud
 * spans a few dozen cells, so ±512 never wraps. Two cells that share a hash
 * bucket keep different keys.
 */
function cellKey(c: TslNode): TslNode {
  return uint(c.x.add(512))
    .bitOr(uint(c.y.add(512)).shiftLeft(10))
    .bitOr(uint(c.z.add(512)).shiftLeft(20));
}

function cellCoord(p: TslNode, size: number): TslNode {
  return ivec3(floor(p.div(size)));
}

/** One sphere's running collision sums, as shader variables. */
interface Contact {
  readonly p: TslNode;
  readonly v: TslNode;
  readonly push: TslNode;
  readonly kick: TslNode;
  readonly impact: TslNode;
}

/**
 * Every sphere in grid cell `coord`, met by `self` (emitted into the calling
 * kernel). The bucket is shared by every cell that hashes to it, so only the
 * entries carrying this cell's key are met: a sphere is met once, from the one
 * probe whose cell it is in, even when two of the 27 probes share a bucket.
 */
function scanCell(b: EmberBuffers, coord: TslNode, size: number, self: Contact): void {
  const bucket = hashCell(coord).toVar();
  const key = cellKey(coord).toVar();
  // Materialised before the loop: left inline as the bound, no contact was ever found.
  const filled = int(atomicLoad(b.cells.element(bucket)))
    .min(SLOTS)
    .toVar();
  loop(filled, (s) => {
    const entry = b.slots.element(bucket.mul(SLOTS).add(uint(s))).toVar();
    If(entry.y.equal(key), () => meet(b, entry.x, size, self));
  });
}

/** Sphere `j` against `self`: move out of it, bounce off it, and heat by the impact. */
function meet(b: EmberBuffers, j: TslNode, size: number, self: Contact): void {
  If(j.notEqual(instanceIndex), () => {
    const d = b.position.element(j).sub(self.p).toVar();
    const dist = length(d).toVar();
    If(dist.lessThan(size).and(dist.greaterThan(1e-5)), () => {
      const normal = d.div(dist).toVar();
      self.push.subAssign(normal.mul(float(size).sub(dist).mul(0.5)));
      const closing = dot(b.velocity.element(j).sub(self.v), normal).toVar();
      If(closing.lessThan(0), () => {
        self.kick.addAssign(normal.mul(closing.mul(0.5)));
        self.impact.subAssign(closing);
      });
    });
  });
}

/**
 * The resting glow, from where a sphere is: warm at the cloud's live core,
 * cooling toward its edge, stirred by a slow noise field — so the core glows
 * untouched and contact heat has somewhere to climb from. It is shown, never
 * stored: it cannot pop anything, and the material caps it (`heat.ts`).
 */
export function restFloor(u: EmberUniforms, p: TslNode, cloud: number): TslNode {
  const fromCore = length(p.sub(u.center)).div(cloud);
  const drift = mx_noise_float(p.mul(0.9).add(vec3(0, u.time.mul(0.07), 0)))
    .mul(0.5)
    .add(0.5);
  const core = float(1)
    .sub(smoothstep(0, 0.8, fromCore))
    .pow(1.4);
  return core.mul(0.5).add(drift.mul(core).mul(0.14));
}

function kernels(u: EmberUniforms, b: EmberBuffers, shape: EmberShape, timing: Timing) {
  const size = shape.sphere * 2;
  const i = instanceIndex;
  const ease = easeNode(timing.settle);

  const clear = Fn(() => {
    atomicStore(b.cells.element(i), 0);
    If(i.equal(0), () => {
      atomicStore(b.tickets.element(0), 0);
    });
  })().compute(TABLE);

  const insert = Fn(() => {
    If(b.state.element(i).x.equal(LIVE), () => {
      const coord = cellCoord(b.position.element(i), size).toVar();
      const bucket = hashCell(coord).toVar();
      const slot = atomicAdd(b.cells.element(bucket), 1).toVar();
      If(slot.lessThan(SLOTS), () => {
        b.slots.element(bucket.mul(SLOTS).add(slot)).assign(uvec2(i, cellKey(coord)));
      });
    });
  })().compute(shape.count);

  const collide = Fn(() => {
    const self: Contact = {
      p: b.position.element(i).toVar(),
      v: b.velocity.element(i).toVar(),
      push: vec3(0).toVar(),
      kick: vec3(0).toVar(),
      impact: float(0).toVar(),
    };
    If(b.state.element(i).x.equal(LIVE), () => {
      const home = cellCoord(self.p, size).toVar();
      loop(27, (n) => {
        const offset = ivec3(n.mod(3).sub(1), n.div(3).mod(3).sub(1), n.div(9).sub(1));
        scanCell(b, home.add(offset).toVar(), size, self);
      });
    });
    b.contact.element(i).assign(self.push);
    b.contact.element(i.add(shape.count)).assign(self.kick);
    b.heat.element(i).addAssign(self.impact.mul(u.gain).mul(0.05));
  })().compute(shape.count);

  const advance = advanceKernel(u, b, shape, timing, ease);
  return [clear, insert, collide, advance];
}

function advanceKernel(
  u: EmberUniforms,
  b: EmberBuffers,
  shape: EmberShape,
  timing: Timing,
  ease: (t: TslNode) => TslNode,
) {
  const i = instanceIndex;
  return Fn(() => {
    const p = b.position.element(i);
    const v = b.velocity.element(i);
    const h = b.home.element(i);
    const life = b.state.element(i);
    const heat = b.heat.element(i);
    const clock = life.y.add(u.dt).toVar();
    life.y.assign(clock);
    const shell = length(h).div(shape.cloud);
    // Constant ambient rotation, the one linear motion (M1); the core turns faster.
    const angle = u.time.mul(0.12).mul(float(1).sub(shell.mul(0.5)));
    const turned = vec3(
      h.x.mul(cos(angle)).sub(h.z.mul(sin(angle))),
      h.y,
      h.x.mul(sin(angle)).add(h.z.mul(cos(angle))),
    );
    const root = mix(float(10), float(2.4), shell);
    const spring = u.center
      .add(turned)
      .sub(p)
      .mul(root.mul(root))
      .sub(v.mul(root.mul(2)));
    const away = p.sub(u.pointer);
    const distance = length(away).max(1e-4);
    const speed = length(u.pointerVelocity);
    const reach = float(1.1).add(speed.mul(0.1)).min(2.4);
    const shove = float(1)
      .sub(smoothstep(0, reach, distance))
      .mul(speed.mul(0.9).min(MAX_SHOVE_SPEED));
    const force = spring
      .add(away.div(distance).mul(shove.mul(40)))
      // Capped as the shove is: however the speed was sampled, the drag
      // along the stroke never exceeds what a fast, real gesture gives.
      .add(
        u.pointerVelocity
          .mul(float(MAX_SHOVE_SPEED).div(speed.max(MAX_SHOVE_SPEED)))
          .mul(shove.mul(2.5)),
      );
    v.assign(v.add(force.mul(u.dt)).add(b.contact.element(i.add(shape.count))));
    p.assign(p.add(v.mul(u.dt)).add(b.contact.element(i)));
    heat.assign(heat.mul(exp(u.cooling.negate().mul(u.dt))));

    If(life.x.equal(LIVE), () => {
      If(heat.greaterThanEqual(u.threshold), () => {
        const ticket = atomicAdd(b.tickets.element(0), 1).toVar();
        If(float(ticket).lessThan(u.grant), () => {
          life.x.assign(POPPING);
          life.y.assign(0);
        });
        heat.assign(u.threshold);
      });
      life.w.assign(heat.div(u.threshold));
    })
      .ElseIf(life.x.equal(POPPING), () => {
        const swell = float(timing.quick);
        const swelling = clock.lessThan(swell);
        const shrink = clock.sub(swell).div(POP_SHRINK).clamp(0, 1);
        life.z.assign(
          mix(
            mix(float(1), float(POP_SWELL), ease(clock.div(swell))),
            float(POP_SWELL).mul(float(1).sub(shrink.mul(shrink))),
            float(swelling.not()),
          ),
        );
        life.w.assign(float(1.6).mul(float(1).sub(shrink)));
        If(clock.greaterThan(swell.add(POP_SHRINK)), () => {
          // Respawn cool at the edge of the cloud, on its home's side, and grow in.
          p.assign(u.center.add(normalize(h).mul(shape.cloud * 1.05)));
          v.assign(vec3(0));
          heat.assign(0);
          life.z.assign(0);
          life.w.assign(0);
          life.x.assign(GROWING);
          life.y.assign(0);
        });
      })
      .Else(() => {
        life.z.assign(ease(clock.div(timing.reveal)));
        life.w.assign(heat.div(u.threshold));
        If(clock.greaterThanEqual(timing.reveal), () => {
          life.x.assign(LIVE);
          life.y.assign(0);
        });
      });
  })().compute(shape.count);
}

export function emberSimulation(homes: Float32Array, shape: EmberShape, timing: Timing) {
  const u = emberUniforms();
  const b = buffers(homes, shape.count);
  return { u, buffers: b, passes: kernels(u, b, shape, timing) };
}
