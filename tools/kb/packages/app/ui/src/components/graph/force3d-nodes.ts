/**
 * The 3D graph's nodes: every node one instance of one sphere, placed, sized,
 * tinted and emphasised from per-instance attributes the CPU writes, so the
 * whole graph is a single draw (Lab principle P3).
 *
 * Shading is the scene kit's key/fill/rim rig baked into the node material
 * (L2, L5): a soft key from the upper left, a fill that keeps the dark side
 * in the node's own colour, and a rim in the palette's ink that draws the
 * silhouette out of the ground. It stays inside the displayable range; only
 * glow (`force3d-emphasis`) lifts a node past 1, so only glowing nodes cross
 * the bloom threshold. A dimmed node sinks toward the ground colour rather
 * than turning transparent, so the graph needs no depth sorting.
 */
import {
  Color,
  InstancedMesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  InstancedBufferAttribute,
} from "three/webgpu";
import {
  float,
  instancedDynamicBufferAttribute,
  mix,
  normalView,
  normalize,
  positionLocal,
  vec3,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import { toRenderableColor } from "@/lib/css-color";
import type { Force3dFades, Force3dTopology } from "./force3d-emphasis";

/** How far past white a fully glowing node's colour goes (L2: only HDR glows). */
const GLOW_GAIN = 1.3;
/** World radius per cube root of a lens node's size. */
const RADIUS_PER_SIZE = 4.2;
/** How much the node in focus swells. */
const FOCUS_SWELL = 0.45;
/** Above this many nodes the sphere is tessellated more coarsely. */
const DENSE = 2000;

export interface NodeLayer {
  readonly mesh: InstancedMesh;
  /** World radius of node `i` now (with its focus swell). */
  radius(i: number): number;
  /** Write positions and eased emphasis into the instance data. */
  update(positions: Float32Array): void;
  /**
   * New encodings (colour, size) for the same nodes in the same order: tints
   * and radii are re-read, so spheres and picking follow a size change.
   */
  restyle(nodes: Force3dTopology["nodes"]): void;
}

export function nodeLayer(
  topology: Force3dTopology,
  colors: PaletteUniforms,
  fades: Force3dFades,
): NodeLayer {
  const n = Math.max(1, topology.nodes.length);
  const place = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const tint = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const look = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
  const base = new Float32Array(n);

  const material = new MeshBasicNodeMaterial();
  const at = instancedDynamicBufferAttribute(place, "vec4");
  const hue = instancedDynamicBufferAttribute(tint, "vec3");
  const emphasis = instancedDynamicBufferAttribute(look, "vec2");
  material.positionNode = positionLocal.mul(at.w).add(at.xyz);
  const normal = normalize(normalView);
  const key = normal.dot(normalize(vec3(-0.45, 0.62, 0.64))).max(0);
  const rim = float(1).sub(normal.z.max(0)).pow(2.4);
  const lit = hue.mul(key.mul(0.5).add(0.42)).add(colors.ink.mul(rim.mul(0.16)));
  const presence = emphasis.x.pow(2);
  material.colorNode = mix(colors.ground, lit, presence).add(hue.mul(emphasis.y.mul(GLOW_GAIN)));

  const segments = topology.nodes.length > DENSE ? [12, 8] : [24, 16];
  const mesh = new InstancedMesh(new SphereGeometry(1, segments[0], segments[1]), material, n);
  mesh.count = topology.nodes.length;
  // Instances are placed by `place`, not by instance matrices, so three's
  // bounds (from the identity matrices) mean nothing.
  mesh.frustumCulled = false;

  const scratch = new Color();
  const restyle = (nodes: Force3dTopology["nodes"]) => {
    nodes.forEach((node, i) => {
      scratch.set(toRenderableColor(node.color) ?? "rgb(128, 128, 128)");
      tint.setXYZ(i, scratch.r, scratch.g, scratch.b);
      base[i] = Math.cbrt(Math.max(0.5, node.size)) * RADIUS_PER_SIZE;
    });
    tint.needsUpdate = true;
  };
  restyle(topology.nodes);

  const radius = (i: number) => (base[i] ?? 1) * (1 + FOCUS_SWELL * (fades.focus.values[i] ?? 0));
  return {
    mesh,
    radius,
    restyle,
    update: (positions) => {
      const count = topology.nodes.length;
      const p = place.array;
      const e = look.array;
      for (let i = 0; i < count; i++) {
        p[i * 4] = positions[i * 3] ?? 0;
        p[i * 4 + 1] = positions[i * 3 + 1] ?? 0;
        p[i * 4 + 2] = positions[i * 3 + 2] ?? 0;
        p[i * 4 + 3] = radius(i);
        e[i * 2] = fades.dim.values[i] ?? 1;
        e[i * 2 + 1] = fades.glow.values[i] ?? 0;
      }
      place.needsUpdate = true;
      look.needsUpdate = true;
    },
  };
}
