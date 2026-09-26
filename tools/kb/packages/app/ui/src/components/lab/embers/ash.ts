/**
 * Floating ash: a seeded drift of specks rising through the air round the
 * cloud (Lab principles L3, M4). Most are grey ash; one in six is a fleck
 * of ember that flickers — always under the bloom threshold, so the only
 * things that bloom are the cloud's hot spheres and its pops (L2).
 *
 * The drift is a function of time drawn in the vertex stage — nothing is
 * simulated — so it costs one instanced sprite, and a still frame (reduced
 * motion) is simply the drift at one instant. Near specks are larger and
 * fainter, as if out of focus; far ones fade into the ground with the fog.
 */
import { InstancedBufferAttribute, Sprite, SpriteNodeMaterial } from "three/webgpu";
import {
  exp,
  float,
  fract,
  instancedBufferAttribute,
  mix,
  sin,
  smoothstep,
  uv,
  vec3,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import type { TslNode } from "@/scene/gpu/tsl";
import { EMBER_TINT } from "@/components/lab/embers/heat";
import { seededRandom } from "@/components/lab/kit/seeded";

const COUNT = 1600;
/** The drifting volume: width, height, depth (world units), round the cloud. */
const SPAN = [30, 18, 16] as const;
const DEPTH_FROM = -9;

export function ash(colors: PaletteUniforms, time: TslNode, arrival: TslNode): Sprite {
  const random = seededRandom(0x2545f491);
  // x, y, z: home in the volume, 0–1; w: a phase. The second: speed, size, ember, flicker.
  const homes = new Float32Array(COUNT * 4);
  const looks = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    homes.set([random(), random(), random(), random() * Math.PI * 2], i * 4);
    looks.set([0.25 + random() * 0.5, random(), random() < 1 / 6 ? 1 : 0, random() * 20], i * 4);
  }
  const home = instancedBufferAttribute(new InstancedBufferAttribute(homes, 4));
  const look = instancedBufferAttribute(new InstancedBufferAttribute(looks, 4));
  // Rising, wrapping at the top; a slow sideways sway over periods past 8s (M4).
  const lift = fract(home.y.add(time.mul(look.x).mul(0.035)));
  const sway = sin(time.mul(0.45).add(home.w)).mul(0.5);
  const position = vec3(
    home.x.sub(0.5).mul(SPAN[0]).add(sway),
    lift.sub(0.5).mul(SPAN[1]),
    home.z
      .mul(SPAN[2])
      .add(DEPTH_FROM)
      .add(sin(time.mul(0.31).add(home.w.mul(2))).mul(0.3)),
  );
  const near = smoothstep(2, 7, position.z);
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.positionNode = position;
  material.scaleNode = look.y.mul(0.05).add(0.025).mul(near.mul(2.5).add(1));
  const flicker = sin(time.mul(3.1).add(look.w)).mul(0.25).add(0.75);
  const ember = colors.accent.mul(vec3(...EMBER_TINT)).mul(flicker.mul(0.9));
  const grey = mix(colors.ground, colors.ink, 0.45);
  material.colorNode = mix(grey, ember, look.z);
  const q = uv().sub(0.5).mul(2);
  // Soft discs; out-of-focus ones softer still. Faded where they wrap.
  const disc = exp(q.dot(q).mul(near.mul(-4).sub(5)));
  const ends = smoothstep(0, 0.08, lift).mul(float(1).sub(smoothstep(0.9, 1, lift)));
  material.opacityNode = disc
    .mul(ends)
    .mul(mix(float(0.42), float(0.9), look.z))
    .mul(float(1).sub(near.mul(0.55)))
    .mul(arrival);
  const sprite = new Sprite(material);
  sprite.count = COUNT;
  sprite.frustumCulled = false;
  return sprite;
}
