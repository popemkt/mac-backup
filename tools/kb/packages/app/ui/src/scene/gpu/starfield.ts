/**
 * A starfield: a seeded scatter of faint, tiny, still points on a sphere
 * round the viewer, drawn as one instanced sprite in the palette's ink. It is
 * decoration, never data, and it sits beyond the atmosphere: fog never reaches
 * it (Lab principle L3 is for things at a distance, and the sky is not one).
 */
import { InstancedBufferAttribute, Sprite, SpriteNodeMaterial } from "three/webgpu";
import { exp, float, instancedBufferAttribute, uniform, uv } from "three/tsl";
import { scatterPlace, sphereDirection } from "@/scene/sphere";
import type { PaletteUniforms } from "@/scene/gpu/stage";

export interface StarfieldOptions {
  /** Names the scatter; the same seed always lays the same stars. */
  readonly seed: string;
  readonly count: number;
  readonly radius: number;
  /** A star's size, in world units at `radius`. */
  readonly size: number;
  /** A star's peak opacity, 0–1. */
  readonly opacity: number;
}

export function starfield(colors: PaletteUniforms, options: StarfieldOptions) {
  const positions = new Float32Array(options.count * 3);
  for (let i = 0; i < options.count; i++) {
    const [x, y, z] = sphereDirection(scatterPlace(options.seed, i));
    positions.set([x * options.radius, y * options.radius, z * options.radius], i * 3);
  }
  const opacity = uniform(options.opacity);
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.fog = false;
  material.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(positions, 3));
  material.scaleNode = float(options.size);
  material.colorNode = colors.ink;
  const q = uv().sub(0.5).mul(2);
  material.opacityNode = exp(q.dot(q).mul(-30)).mul(opacity);
  const sprite = new Sprite(material);
  sprite.count = options.count;
  sprite.frustumCulled = false;
  return { sprite, opacity };
}
