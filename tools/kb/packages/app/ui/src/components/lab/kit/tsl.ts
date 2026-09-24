/**
 * The lab's typed seam over TSL (Lab principle T1): the few three/tsl
 * helpers whose published types are looser than the nodes they hand back,
 * wrapped once so no study casts.
 */
import { Loop, int, mix, uniformArray, type ShaderNodeObject } from "three/tsl";
import type { Node } from "three/webgpu";
import { easeAt, type CubicBezier } from "@/components/lab/kit/timing";

export type TslNode = ShaderNodeObject<Node>;

/**
 * A loop over `0 … end` in a shader, handing the body its index as the node
 * it is. `@types/three` declares `Loop`'s index as a plain `number` though at
 * runtime it is an int node; this is the one place that bridges the two.
 */
export function loop(end: number | TslNode, body: (index: TslNode) => void): void {
  Loop({ start: 0, end, type: "int" }, ({ i }) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Loop's typings declare its index `number`; it is an int node (see above)
    body(i as unknown as TslNode);
  });
}

/** How finely the ease is sampled for the GPU. */
const EASE_SAMPLES = 33;

/**
 * The `--motion-settle` ease as a shader function (M6): the same curve the CPU
 * solves in `easeAt`, sampled into a uniform array and read back linearly,
 * so a shader's timing and a script's are one vocabulary.
 */
export function easeNode(curve: CubicBezier): (t: TslNode) => TslNode {
  const table = uniformArray(
    Array.from({ length: EASE_SAMPLES }, (_, i) => easeAt(curve, i / (EASE_SAMPLES - 1))),
    "float",
  );
  return (t) => {
    const at = t.clamp(0, 1).mul(EASE_SAMPLES - 1);
    const low = int(at.floor());
    const high = low.add(1).min(EASE_SAMPLES - 1);
    return mix(table.element(low), table.element(high), at.fract());
  };
}
