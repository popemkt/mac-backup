/**
 * The 3D graph's solid nodes: every node one instance of one solid — the
 * sphere, or the cube (`SOLIDS`, chosen by the theme's form) — placed, sized,
 * tinted and emphasised from per-instance attributes the CPU writes, so the
 * whole graph is a single draw (Lab principle P3).
 *
 * Shading is the scene kit's key/fill/rim rig baked into the node material,
 * written once in `force3d-light` (`shadeNode`, in the theme's surface)
 * and run here as TSL nodes (L2, L5); in the matte surface: a soft key from the upper left, a fill that keeps the dark side
 * in the node's own colour, and a rim in the palette's ink that draws the
 * silhouette out of the ground. It stays inside the displayable range; only
 * glow (`force3d-emphasis`) lifts a node past 1, so only glowing nodes cross
 * the bloom threshold. A dimmed node sinks toward the ground colour rather
 * than turning transparent, so the graph needs no depth sorting.
 */
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  InstancedMesh,
  type Object3D,
  MeshBasicNodeMaterial,
  SphereGeometry,
  InstancedBufferAttribute,
} from "three/webgpu";
import {
  float,
  instancedDynamicBufferAttribute,
  max,
  normalView,
  normalize,
  positionLocal,
  smoothstep,
  uv,
  vec3,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import type { ScenePalette } from "@/scene/palette";
import { toRenderableColor } from "@kb/ui-sdk";
import { TIER, type Force3dFades, type Force3dTopology } from "./force3d-emphasis";
import { KEY_DIRECTION, RIM_POWER, shadeNode } from "./force3d-light";
import type { GraphTheme, SolidForm } from "./graph-themes";
import { NODE_OPS, type TslNode } from "@/scene/gpu/tsl";

/** World radius per cube root of a lens node's size. */
const RADIUS_PER_SIZE = 4.2;
/** How much the node in focus swells. */
const FOCUS_SWELL = 0.45;
/** How much larger a hub stands. */
const HUB_SWELL = 0.4;
/** Above this many nodes the sphere is tessellated more coarsely. */
const DENSE = 2000;

/**
 * A cube's half-edge per unit of node radius: the cube holds the volume of
 * the sphere the node would be in another theme ((π/6)^⅓ ≈ 0.81), so a
 * hub's cube weighs what its sphere did and sizes compare across themes.
 */
export const CUBE_HALF_EDGE = Math.cbrt(Math.PI / 6);
/** How wide a cube's edge line is, as a share of a face's half-width. */
const CUBE_EDGE = 0.1;

type NormalNode = TslNode<"vec3">;
type ScalarNode = TslNode<"float">;

/**
 * A solid a node may be drawn as: its unit geometry (radius 1 in the node's
 * own units) and the rim its surface is lit by — how near a fragment is to
 * the solid's outline, 0–1 (`force3d-light`).
 */
interface Solid {
  geometry(nodes: number): BufferGeometry;
  rim(normal: NormalNode): ScalarNode;
}

/** The grazing rim: 1 where the surface turns away from the eye. */
const grazing = (normal: NormalNode) => float(1).sub(normal.z.max(0)).pow(RIM_POWER);

const SOLIDS: Record<SolidForm, Solid> = {
  sphere: {
    geometry: (nodes) =>
      nodes > DENSE ? new SphereGeometry(1, 12, 8) : new SphereGeometry(1, 24, 16),
    rim: grazing,
  },
  /**
   * The cube, set once in the isometric attitude — a corner toward the
   * default eye, so three faces show and each takes the key differently.
   * It stays put: a cube in motion would keep the stage drawing, and one
   * shared attitude lets the faces' light, not their angle, carry the
   * hierarchy. Its rim is the grazing rim of a face turned away, or a thin
   * line along every edge, so a silhouette and each edge are drawn out.
   */
  cube: {
    geometry: () => {
      const edge = 2 * CUBE_HALF_EDGE;
      return new BoxGeometry(edge, edge, edge)
        .rotateY(Math.PI / 4)
        .rotateX(Math.atan(1 / Math.SQRT2));
    },
    rim: (normal) => {
      const q = uv().sub(0.5).abs().mul(2);
      const line = smoothstep(1 - CUBE_EDGE, 1 - CUBE_EDGE * 0.25, max(q.x, q.y));
      return max(grazing(normal), line);
    },
  },
};

export interface NodeLayer {
  readonly mesh: Object3D;
  /** World radius of node `i` now (with its focus swell). */
  radius(i: number): number;
  /** Write positions and eased emphasis into the instance data. */
  update(positions: Float32Array): void;
  /**
   * New encodings (colour, size) for the same nodes in the same order: tints
   * and radii are re-read, so spheres and picking follow a size change.
   */
  restyle(nodes: Force3dTopology["nodes"]): void;
  /** A new palette: what the layer copied out of it is read again (uniforms need nothing). */
  setPalette(palette: ScenePalette): void;
  /** Free what the scene's traversal does not reach (a texture a material holds). */
  dispose(): void;
}

/**
 * Every 3D node's world radius, whatever it is drawn as: the cube root of its
 * lens size, a hub a little larger, the node in focus swelled, and grown in
 * as it arrives. `sizes` holds each node's base radius (`baseRadius`).
 */
export function nodeRadius(
  topology: Force3dTopology,
  fades: Force3dFades,
  arrival: { readonly values: Float32Array },
  sizes: Float32Array,
): (i: number) => number {
  return (i) =>
    (sizes[i] ?? 1) *
    (topology.tier[i] === TIER.hub ? 1 + HUB_SWELL : 1) *
    (1 + FOCUS_SWELL * (fades.focus.values[i] ?? 0)) *
    (arrival.values[i] ?? 1);
}

/** A node's radius before the swells: the cube root of its lens size. */
export function baseRadius(size: number): number {
  return Math.cbrt(Math.max(0.5, size)) * RADIUS_PER_SIZE;
}

/** What a node layer is drawn from, whatever form its theme draws nodes in. */
export interface NodeLayerInit {
  readonly topology: Force3dTopology;
  readonly colors: PaletteUniforms;
  readonly fades: Force3dFades;
  readonly theme: GraphTheme;
  readonly palette: ScenePalette;
  /** How far each node has arrived (`lib/graph-arrival`): it grows in from the hubs. */
  readonly arrival?: { readonly values: Float32Array };
}

const NOT_ARRIVING = { values: new Float32Array(0) };

/** The layer drawing every node as one instance of `form`'s solid. */
export const solidLayer =
  (form: SolidForm) =>
  (init: NodeLayerInit): NodeLayer =>
    drawSolids(SOLIDS[form], init);

function drawSolids(
  solid: Solid,
  { topology, colors, fades, theme, arrival = NOT_ARRIVING }: NodeLayerInit,
): NodeLayer {
  const n = Math.max(1, topology.nodes.length);
  const place = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const tint = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const look = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const base = new Float32Array(n);

  const material = new MeshBasicNodeMaterial();
  const at = instancedDynamicBufferAttribute<"vec4">(place, "vec4");
  const hue = instancedDynamicBufferAttribute<"vec3">(tint, "vec3");
  const emphasis = instancedDynamicBufferAttribute<"vec3">(look, "vec3");
  material.positionNode = positionLocal.mul(at.w).add(at.xyz);
  const normal = normalize(normalView);
  const key = normal.dot(vec3(...KEY_DIRECTION)).max(0);
  const rim = solid.rim(normal);
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
    theme.scene.surface,
    theme.scene.bloom !== null,
  );

  const mesh = new InstancedMesh(solid.geometry(topology.nodes.length), material, n);
  mesh.count = topology.nodes.length;
  // Instances are placed by `place`, not by instance matrices, so three's
  // bounds (from the identity matrices) mean nothing.
  mesh.frustumCulled = false;

  const scratch = new Color();
  const restyle = (nodes: Force3dTopology["nodes"]) => {
    nodes.forEach((node, i) => {
      scratch.set(toRenderableColor(node.color) ?? "rgb(128, 128, 128)");
      tint.setXYZ(i, scratch.r, scratch.g, scratch.b);
      base[i] = baseRadius(node.size);
    });
    tint.needsUpdate = true;
  };
  restyle(topology.nodes);

  // The degree hierarchy reads in size as well as light: hubs stand a little larger.
  const radius = nodeRadius(topology, fades, arrival, base);
  return {
    mesh,
    radius,
    restyle,
    setPalette: () => {},
    dispose: () => {},
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
