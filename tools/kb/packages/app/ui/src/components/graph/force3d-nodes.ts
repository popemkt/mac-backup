/**
 * The 3D graph's nodes: every node one instance of one sphere, placed, sized,
 * tinted and emphasised from per-instance attributes the CPU writes, so the
 * whole graph is a single draw (Lab principle P3).
 *
 * Shading is the scene kit's key/fill/rim rig baked into the node material,
 * written once in `force3d-light` (`shadeNode`, in the perspective's look)
 * and run here as TSL nodes (L2, L5); in the matte look: a soft key from the upper left, a fill that keeps the dark side
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
  normalView,
  normalize,
  positionLocal,
  vec3,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import { toRenderableColor } from "@/lib/css-color";
import { TIER, type Force3dFades, type Force3dTopology } from "./force3d-emphasis";
import { KEY_DIRECTION, RIM_POWER, shadeNode, type NodeLook } from "./force3d-light";
import { NODE_OPS } from "@/scene/gpu/tsl";

/** World radius per cube root of a lens node's size. */
const RADIUS_PER_SIZE = 4.2;
/** How much the node in focus swells. */
const FOCUS_SWELL = 0.45;
/** How much larger a hub stands. */
const HUB_SWELL = 0.4;
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
  nodeLook: NodeLook,
  /** How far each node has arrived (`lib/graph-arrival`): it grows in from the hubs. */
  arrival: { readonly values: Float32Array } = { values: new Float32Array(0) },
): NodeLayer {
  const n = Math.max(1, topology.nodes.length);
  const place = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const tint = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const look = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const base = new Float32Array(n);

  const material = new MeshBasicNodeMaterial();
  const at = instancedDynamicBufferAttribute(place, "vec4");
  const hue = instancedDynamicBufferAttribute(tint, "vec3");
  const emphasis = instancedDynamicBufferAttribute(look, "vec3");
  material.positionNode = positionLocal.mul(at.w).add(at.xyz);
  const normal = normalize(normalView);
  const key = normal.dot(vec3(...KEY_DIRECTION)).max(0);
  const rim = float(1).sub(normal.z.max(0)).pow(RIM_POWER);
  material.colorNode = shadeNode(
    NODE_OPS,
    {
      hue: vec3(hue),
      ground: vec3(colors.ground),
      ink: vec3(colors.ink),
      key,
      rim,
      presence: emphasis.x.pow(2),
      glow: emphasis.y,
      lift: emphasis.z,
    },
    nodeLook,
  );

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

  // The degree hierarchy reads in size as well as light: hubs stand a little larger.
  const radius = (i: number) =>
    (base[i] ?? 1) *
    (topology.tier[i] === TIER.hub ? 1 + HUB_SWELL : 1) *
    (1 + FOCUS_SWELL * (fades.focus.values[i] ?? 0)) *
    (arrival.values[i] ?? 1);
  return {
    mesh,
    radius,
    restyle,
    update: (positions) => {
      const count = topology.nodes.length;
      const p = place.array;
      const e = look.array;
      const lift = fades.lift.values;
      for (let i = 0; i < count; i++) {
        p[i * 4] = positions[i * 3] ?? 0;
        p[i * 4 + 1] = positions[i * 3 + 1] ?? 0;
        p[i * 4 + 2] = positions[i * 3 + 2] ?? 0;
        p[i * 4 + 3] = radius(i);
        e[i * 3] = fades.dim.values[i] ?? 1;
        e[i * 3 + 1] = fades.glow.values[i] ?? 0;
        e[i * 3 + 2] = lift[i] ?? 0;
      }
      place.needsUpdate = true;
      look.needsUpdate = true;
    },
  };
}
