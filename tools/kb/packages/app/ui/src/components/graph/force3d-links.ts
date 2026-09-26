/**
 * The 3D graph's links and the particles that show their direction.
 *
 * Links are one line-segment batch. Direction reads without arrows: each
 * link brightens from its source to its target. A link touching the node in
 * focus takes the accent and comes forward; a link into the dimmed rest
 * recedes with it — every link's colour follows its endpoints' eased
 * emphasis, so it fades with them (M1). Curved links are a quadratic arc
 * drawn as a few segments.
 *
 * A link's **style** is data a perspective chooses (`lens.link-style`):
 * `lines`, the plain batch, or `flow`, the same batch with dashes that drift
 * from source to target — one dash passing in the ambient period (M4), so it
 * reads as a direction, never as a hero motion; under reduced motion the
 * dashes stand still (M7). Neither style lifts a link past its resting
 * colour, so no link blooms (L2).
 *
 * Particles are one instanced sprite: a few bright motes travelling source →
 * target along the focused node's links only (M4), bright past 1 so they
 * bloom (L2), easing in and out with the focus. Under reduced motion they
 * are not shown (M7); the gradient still carries direction.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  LineBasicNodeMaterial,
  LineSegments,
  Sprite,
  SpriteNodeMaterial,
} from "three/webgpu";
import {
  attribute,
  exp,
  float,
  fract,
  instancedDynamicBufferAttribute,
  mix,
  smoothstep,
  uniform,
  uv,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import type { ScenePalette } from "@/scene/palette";
import { approach } from "@/lib/timing";
import type { LensLinkStyle } from "@/lib/graph-lens";
import type { Force3dFades, Force3dTopology } from "./force3d-emphasis";

/** Segments per link when curved; a straight link is one. */
const CURVE_SEGMENTS = 8;
/** How far a curved link's middle bows out, per unit of its length. */
const CURVATURE = 0.22;
/** A link's opacity in focus. (At rest its colour and alpha are `--graph-edge`.) */
const FOCUSED = 0.85;
/** The source end's share of a link's brightness: the gradient that shows direction. */
const SOURCE_SHARE = 0.3;
/** A flow dash's length and the share of it that is lit, world units. */
const DASH = 28;
const DASH_LIT = 0.45;
/** Between dashes a flowing link keeps this much of its light. */
const DASH_REST = 0.2;

const PARTICLES_PER_LINK = 3;
export const MAX_PARTICLE_LINKS = 96;
/** Seconds a particle takes to cross its link. */
const CROSSING = 1.8;
/** How far past white a particle's light goes. */
const PARTICLE_GAIN = 3.2;

/** Where the links' points are: the positions this frame, and the link shape. */
interface LinkPath {
  positions: Float32Array;
  readonly curved: boolean;
}

export interface LinkLayer {
  readonly lines: LineSegments;
  update(positions: Float32Array): void;
  /** The accent from the palette; the resting link from `--graph-edge` (rgb/rgba). */
  setPalette(palette: ScenePalette, link: string): void;
  /** Move a flowing style on by `dt`; whether it still moves. */
  step(dt: number, reduced: boolean): boolean;
  /** Where the flow's dashes are (0–1 of a dash): what a redrawn layer carries on from. */
  flowPhase(): number;
}

export interface LinkLayerOptions {
  readonly curved: boolean;
  readonly style: LensLinkStyle;
  /** `--motion-ambient-period`: the time one dash takes to pass. */
  readonly ambientPeriod: number;
  /** Carry the dashes on from a layer this one replaces (`flowPhase`). */
  readonly flowPhase?: number;
}

export function linkLayer(
  topology: Force3dTopology,
  fades: Force3dFades,
  options: LinkLayerOptions,
): LinkLayer {
  const linkCount = topology.links.length / 2;
  const segments = options.curved ? CURVE_SEGMENTS : 1;
  const vertices = Math.max(1, linkCount * segments * 2);
  const position = new BufferAttribute(new Float32Array(vertices * 3), 3);
  const tint = new BufferAttribute(new Float32Array(vertices * 4), 4);
  // How far along its link a vertex is, world units: where a flow dash falls.
  const along = new BufferAttribute(new Float32Array(vertices), 1);
  for (const attr of [position, tint, along]) attr.setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", position);
  geometry.setAttribute("tint", tint);
  geometry.setAttribute("along", along);
  geometry.setDrawRange(0, linkCount * segments * 2);
  const material = new LineBasicNodeMaterial({ transparent: true, depthWrite: false });
  const vertexTint = attribute("tint", "vec4");
  const time = uniform(options.flowPhase ?? 0);
  const flowing = options.style === "flow";
  const dash = fract(attribute("along", "float").div(DASH).sub(time));
  const flow = flowing
    ? mix(float(DASH_REST), float(1), smoothstep(1 - DASH_LIT, 1, dash))
    : float(1);
  material.colorNode = vertexTint.xyz;
  material.opacityNode = vertexTint.w.mul(flow);
  // One pixel wide, whatever the weight: GPU lines have no width. GAP [[01M3AZSFJ9A8K8FYGHF5ADEAPT]]
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;

  const ink = new Color();
  const accent = new Color();
  const mixed = new Color();
  let rest = 0.3;
  const at = { x: 0, y: 0, z: 0 };
  const path: LinkPath = { positions: new Float32Array(0), curved: options.curved };
  const write = (v: number, c: Color, a: number, distance: number) => {
    position.setXYZ(v, at.x, at.y, at.z);
    tint.setXYZW(v, c.r, c.g, c.b, a);
    along.setX(v, distance);
  };
  const period = Math.max(1, options.ambientPeriod);

  return {
    lines,
    setPalette: (palette, link) => {
      const rgba = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(link);
      ink.set(rgba === null ? palette.ink : `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})`);
      rest = rgba?.[4] === undefined ? 1 : Number(rgba[4]);
      accent.set(palette.accent);
    },
    update: (positions) => {
      path.positions = positions;
      let v = 0;
      for (let l = 0; l < linkCount; l++) {
        const a = topology.links[l * 2] ?? 0;
        const b = topology.links[l * 2 + 1] ?? 0;
        const near = Math.max(fades.focus.values[a] ?? 0, fades.focus.values[b] ?? 0);
        const present = Math.min(fades.dim.values[a] ?? 1, fades.dim.values[b] ?? 1);
        const alpha = rest * present * present * (1 - near) + FOCUSED * near;
        const length = chordLength(positions, a, b);
        mixed.copy(ink).lerp(accent, near);
        for (let s = 0; s < segments; s++) {
          const t0 = s / segments;
          const t1 = (s + 1) / segments;
          pointOn(path, a, b, t0, at);
          write(v++, mixed, alpha * (SOURCE_SHARE + (1 - SOURCE_SHARE) * t0), t0 * length);
          pointOn(path, a, b, t1, at);
          write(v++, mixed, alpha * (SOURCE_SHARE + (1 - SOURCE_SHARE) * t1), t1 * length);
        }
      }
      position.needsUpdate = true;
      tint.needsUpdate = true;
      along.needsUpdate = true;
    },
    step: (dt, reduced) => {
      if (!flowing || reduced) return false;
      time.value = (time.value + dt / period) % 1;
      return true;
    },
    flowPhase: () => time.value,
  };
}

export interface ParticleLayer {
  readonly sprite: Sprite;
  /** The links that carry particles now; empty turns them off (eased). */
  setLinks(links: readonly number[]): void;
  /** Move the particles on by `dt`; returns whether any are still showing. */
  step(dt: number, positions: Float32Array, reduced: boolean, fadeRate: number): boolean;
  /** How many particles are drawn now. */
  count(): number;
  /** Where the particles are and how far they have faded in: what a redrawn layer carries on from. */
  motion(): ParticleMotion;
}

export interface ParticleMotion {
  readonly showing: number;
  readonly phase: number;
  readonly wanted: boolean;
  readonly carrying: readonly number[];
}

export function particleLayer(
  topology: Force3dTopology,
  colors: PaletteUniforms,
  curved: boolean,
  carried?: ParticleMotion,
): ParticleLayer {
  // Positions written on the CPU, a soft HDR mote each.
  const maxParticles = MAX_PARTICLE_LINKS * PARTICLES_PER_LINK;
  const moteAt = new InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3);
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const showing = uniform(carried?.showing ?? 0);
  material.positionNode = instancedDynamicBufferAttribute(moteAt, "vec3");
  const q = uv().sub(0.5).mul(2);
  material.colorNode = colors.accent.mul(PARTICLE_GAIN);
  material.opacityNode = exp(q.dot(q).mul(-6)).mul(showing);
  material.scaleNode = float(2.4);
  const sprite = new Sprite(material);
  sprite.frustumCulled = false;
  sprite.count = 0;
  sprite.visible = false;
  let carrying: readonly number[] = carried?.carrying ?? [];
  let wanted = carried?.wanted ?? false;
  let phase = carried?.phase ?? 0;
  sprite.count = carrying.length * PARTICLES_PER_LINK;
  const at = { x: 0, y: 0, z: 0 };
  const path: LinkPath = { positions: new Float32Array(0), curved };
  return {
    sprite,
    count: () => (sprite.visible ? sprite.count : 0),
    motion: () => ({ showing: showing.value, phase, wanted, carrying }),
    setLinks: (links) => {
      wanted = links.length > 0;
      if (wanted) {
        carrying = links.slice(0, MAX_PARTICLE_LINKS);
        sprite.count = carrying.length * PARTICLES_PER_LINK;
      }
    },
    step: (dt, positions, reduced, fadeRate) => {
      const target = wanted && !reduced ? 1 : 0;
      showing.value = reduced ? target : approach(showing.value, target, fadeRate, dt);
      if (Math.abs(showing.value - target) < 1e-3) showing.value = target;
      sprite.visible = showing.value > 0 && carrying.length > 0;
      if (!sprite.visible) {
        if (!wanted) carrying = [];
        return false;
      }
      phase = (phase + dt / CROSSING) % 1;
      path.positions = positions;
      const out = moteAt.array;
      let m = 0;
      for (const l of carrying) {
        const a = topology.links[l * 2] ?? 0;
        const b = topology.links[l * 2 + 1] ?? 0;
        for (let k = 0; k < PARTICLES_PER_LINK; k++) {
          pointOn(path, a, b, (phase + k / PARTICLES_PER_LINK) % 1, at);
          out[m * 3] = at.x;
          out[m * 3 + 1] = at.y;
          out[m * 3 + 2] = at.z;
          m++;
        }
      }
      moteAt.needsUpdate = true;
      return true;
    },
  };
}

function chordLength(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    (positions[b * 3] ?? 0) - (positions[a * 3] ?? 0),
    (positions[b * 3 + 1] ?? 0) - (positions[a * 3 + 1] ?? 0),
    (positions[b * 3 + 2] ?? 0) - (positions[a * 3 + 2] ?? 0),
  );
}

/**
 * The point `t` of the way along link a → b: the straight chord, or the
 * quadratic arc bowed CURVATURE of its length out, perpendicular to it in the
 * plane with the world up (with x, for a vertical link). Written into `out`.
 */
function pointOn(
  { positions, curved }: LinkPath,
  a: number,
  b: number,
  t: number,
  out: { x: number; y: number; z: number },
): void {
  const ax = positions[a * 3] ?? 0;
  const ay = positions[a * 3 + 1] ?? 0;
  const az = positions[a * 3 + 2] ?? 0;
  const bx = positions[b * 3] ?? 0;
  const by = positions[b * 3 + 1] ?? 0;
  const bz = positions[b * 3 + 2] ?? 0;
  if (!curved) {
    out.x = ax + (bx - ax) * t;
    out.y = ay + (by - ay) * t;
    out.z = az + (bz - az) * t;
    return;
  }
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  let px = -dz;
  let py = 0;
  let pz = dx;
  if (Math.abs(px) + Math.abs(pz) < 1e-6) {
    px = 0;
    py = dz;
    pz = -dy;
  }
  const bow = (CURVATURE * Math.hypot(dx, dy, dz)) / (Math.hypot(px, py, pz) || 1);
  const cx = (ax + bx) / 2 + px * bow;
  const cy = (ay + by) / 2 + py * bow;
  const cz = (az + bz) / 2 + pz * bow;
  const u = 1 - t;
  out.x = u * u * ax + 2 * u * t * cx + t * t * bx;
  out.y = u * u * ay + 2 * u * t * cy + t * t * by;
  out.z = u * u * az + 2 * u * t * cz + t * t * bz;
}
