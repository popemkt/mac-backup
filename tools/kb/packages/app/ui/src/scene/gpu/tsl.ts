/**
 * The typed seam over TSL (Lab principle T1): the name kb's shaders give a
 * TSL node, and the few three/tsl helpers whose published types are looser
 * than the nodes they hand back, wrapped once so no scene casts.
 */
import {
  float,
  int,
  max,
  min,
  mix,
  sRGBTransferEOTF,
  smoothstep,
  uniform,
  uniformArray,
  vec3,
} from "three/tsl";
import { Color, type Node, type UniformNode } from "three/webgpu";
import { easeAt, type CubicBezier } from "@/lib/timing";
import type { ShadeOps } from "@/scene/shade-ops";

/**
 * A shader node of TSL type `T` (`"float"`, `"vec3"`, …): three's own typed
 * `Node`. Named apart from it because in kb a node is a graph node.
 */
export type TslNode<T extends string> = Node<T>;

/**
 * A colour as a shader uniform. `@types/three` types a `Color` uniform's node
 * `"color"`, which takes only scalar arithmetic; three builds that node as a
 * vec3, so every vector operation is valid on it. This is the one place that
 * bridges the two.
 */
export function colorUniform(value: Color = new Color()): UniformNode<"vec3", Color> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a "color" node is built as a vec3 (see above)
  return uniform(value) as unknown as UniformNode<"vec3", Color>;
}

/**
 * An sRGB colour taken to linear light. `@types/three` declares
 * `sRGBTransferEOTF` as taking and returning an untyped node, though it
 * hands back a node of its argument's type; this is the one place that
 * bridges the two.
 */
export function linearFromSrgb(color: TslNode<"vec3">): TslNode<"vec3"> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sRGBTransferEOTF's typings return an untyped node; it is its argument's type (see above)
  return sRGBTransferEOTF(color) as TslNode<"vec3">;
}

/**
 * The lesser of an int node and a constant. `@types/three` declares `min` on
 * the float types only, though three builds it for an int as an int; this is
 * the one place that bridges the two.
 */
export function minInt(a: TslNode<"int">, b: number): TslNode<"int"> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- min's typings are float-only; on an int it is an int (see above)
  return (a as unknown as TslNode<"float">).min(b) as unknown as TslNode<"int">;
}

/** How finely the ease is sampled for the GPU. */
const EASE_SAMPLES = 33;

/**
 * The `--motion-settle` ease as a shader function (M6): the same curve the CPU
 * solves in `easeAt`, sampled into a uniform array and read back linearly,
 * so a shader's timing and a script's are one vocabulary.
 */
export function easeNode(curve: CubicBezier): (t: TslNode<"float">) => TslNode<"float"> {
  const table = uniformArray<"float">(
    Array.from({ length: EASE_SAMPLES }, (_, i) => easeAt(curve, i / (EASE_SAMPLES - 1))),
    "float",
  );
  return (t) => {
    const at = t.clamp(0, 1).mul(EASE_SAMPLES - 1);
    const low = int(at.floor());
    const high = minInt(low.add(1), EASE_SAMPLES - 1);
    return mix(table.element(low), table.element(high), at.fract());
  };
}

/**
 * `@/scene/shade-ops`'s arithmetic as TSL nodes: a shading formula written
 * over `ShadeOps` runs on the GPU with these, and on the CPU with
 * `NUMBER_OPS` — one definition, no mirror.
 */
export const NODE_OPS: ShadeOps<TslNode<"vec3">, TslNode<"float">> = {
  num: (value) => float(value),
  add: (a, b) => a.add(b),
  mul: (a, b) => a.mul(b),
  max: (a, b) => a.max(b),
  min: (a, b) => a.min(b),
  smoothstep: (from, to, t) => smoothstep(from, to, t),
  pow: (t, exponent) => t.max(0).pow(exponent),
  band: (t, steps) => t.mul(steps).floor().div(steps),
  mix: (a, b, t) => mix(a, b, t),
  scale: (v, s) => v.mul(s),
  tint: (v, rgb) => v.mul(vec3(...rgb)),
  addColor: (a, b) => a.add(b),
  subColor: (a, b) => a.sub(b),
  divColor: (a, b) => a.div(b),
  minColor: (a, b) => min(a, b),
  maxColor: (a, b) => max(a, b),
  minChannel: (v) => v.x.min(v.y).min(v.z),
  white: vec3(1, 1, 1),
  black: vec3(0, 0, 0),
};
