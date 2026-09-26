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
import { attribute, exp, float, instancedDynamicBufferAttribute, uniform, uv } from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import type { ScenePalette } from "@/scene/palette";
import { approach } from "@/lib/timing";
import type { Force3dFades, Force3dTopology } from "./force3d-emphasis";

/** Segments per link when curved; a straight link is one. */
const CURVE_SEGMENTS = 8;
/** How far a curved link's middle bows out, per unit of its length. */
const CURVATURE = 0.22;
/** A link's opacity in focus. (At rest its colour and alpha are `--graph-edge`.) */
const FOCUSED = 0.85;
/** The source end's share of a link's brightness: the gradient that shows direction. */
const SOURCE_SHARE = 0.3;

export const PARTICLES_PER_LINK = 3;
export const MAX_PARTICLE_LINKS = 96;
/** Seconds a particle takes to cross its link. */
const CROSSING = 1.8;
/** How far past white a particle's light goes. */
const PARTICLE_GAIN = 3.2;

export interface LinkLayer {
  readonly lines: LineSegments;
  readonly particles: Sprite;
  update(positions: Float32Array): void;
  /** The accent from the palette; the resting link from `--graph-edge` (rgb/rgba). */
  setPalette(palette: ScenePalette, link: string): void;
  /** The links that carry particles now; empty turns them off (eased). */
  setParticleLinks(links: readonly number[]): void;
  /** Move the particles on by `dt`; returns whether any are still showing. */
  stepParticles(dt: number, positions: Float32Array, reduced: boolean, fadeRate: number): boolean;
}

export function linkLayer(
  topology: Force3dTopology,
  colors: PaletteUniforms,
  fades: Force3dFades,
  curved: boolean,
): LinkLayer {
  const linkCount = topology.links.length / 2;
  const segments = curved ? CURVE_SEGMENTS : 1;
  const vertices = Math.max(1, linkCount * segments * 2);
  const position = new BufferAttribute(new Float32Array(vertices * 3), 3);
  const tint = new BufferAttribute(new Float32Array(vertices * 4), 4);
  position.setUsage(DynamicDrawUsage);
  tint.setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", position);
  geometry.setAttribute("tint", tint);
  geometry.setDrawRange(0, linkCount * segments * 2);
  const material = new LineBasicNodeMaterial({ transparent: true, depthWrite: false });
  const vertexTint = attribute("tint", "vec4");
  material.colorNode = vertexTint.xyz;
  material.opacityNode = vertexTint.w;
  // One pixel wide, whatever the weight: GPU lines have no width. GAP [[01M3AZSFJ9A8K8FYGHF5ADEAPT]]
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;

  const ink = new Color();
  const accent = new Color();
  let rest = 0.3;

  // Particles: positions written on the CPU, a soft HDR mote each.
  const maxParticles = MAX_PARTICLE_LINKS * PARTICLES_PER_LINK;
  const moteAt = new InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3);
  const moteMaterial = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const showing = uniform(0);
  moteMaterial.positionNode = instancedDynamicBufferAttribute(moteAt, "vec3");
  const q = uv().sub(0.5).mul(2);
  moteMaterial.colorNode = colors.accent.mul(PARTICLE_GAIN);
  moteMaterial.opacityNode = exp(q.dot(q).mul(-6)).mul(showing);
  moteMaterial.scaleNode = float(2.4);
  const particles = new Sprite(moteMaterial);
  particles.frustumCulled = false;
  particles.count = 0;
  particles.visible = false;
  let carrying: readonly number[] = [];
  let wanted = false;
  let phase = 0;

  const at = { x: 0, y: 0, z: 0 };
  /** What `pointOn` reads: the positions this frame, and the link shape. */
  const path: LinkPath = { positions: new Float32Array(0), curved };
  const write = (v: number, p: typeof at, c: Color, a: number) => {
    position.setXYZ(v, p.x, p.y, p.z);
    tint.setXYZW(v, c.r, c.g, c.b, a);
  };
  const mixed = new Color();

  return {
    lines,
    particles,
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
        mixed.copy(ink).lerp(accent, near);
        if (segments === 1) {
          pointOn(path, a, b, 0, at);
          write(v++, at, mixed, alpha * SOURCE_SHARE);
          pointOn(path, a, b, 1, at);
          write(v++, at, mixed, alpha);
          continue;
        }
        for (let s = 0; s < segments; s++) {
          const t0 = s / segments;
          const t1 = (s + 1) / segments;
          pointOn(path, a, b, t0, at);
          write(v++, at, mixed, alpha * (SOURCE_SHARE + (1 - SOURCE_SHARE) * t0));
          pointOn(path, a, b, t1, at);
          write(v++, at, mixed, alpha * (SOURCE_SHARE + (1 - SOURCE_SHARE) * t1));
        }
      }
      position.needsUpdate = true;
      tint.needsUpdate = true;
    },
    setParticleLinks: (links) => {
      wanted = links.length > 0;
      if (wanted) {
        carrying = links.slice(0, MAX_PARTICLE_LINKS);
        particles.count = carrying.length * PARTICLES_PER_LINK;
      }
    },
    stepParticles: (dt, positions, reduced, fadeRate) => {
      const target = wanted && !reduced ? 1 : 0;
      showing.value = reduced ? target : approach(showing.value, target, fadeRate, dt);
      if (Math.abs(showing.value - target) < 1e-3) showing.value = target;
      particles.visible = showing.value > 0 && carrying.length > 0;
      if (!particles.visible) {
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

/**
 * The point `t` of the way along link a → b: the straight chord, or the
 * quadratic arc bowed CURVATURE of its length out, perpendicular to it in the
 * plane with the world up (with x, for a vertical link). Written into `out`.
 */
interface LinkPath {
  positions: Float32Array;
  readonly curved: boolean;
}

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
