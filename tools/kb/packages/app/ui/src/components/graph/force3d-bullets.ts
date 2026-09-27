/**
 * The bullet theme's nodes: every node drawn as the outline draws its bullet.
 *
 * What a node's bullet is — its shape, paints and proportions — is the
 * outline's own definition (`lib/bullet-mode`), read off the same outline
 * node (`LensNode.bullet`), and it is painted by the bullet's canvas renderer
 * (`lib/bullet-paint`) into one atlas, each distinct bullet once. The nodes
 * are one instanced sprite over that atlas, facing the camera: one draw, and
 * the scene stays an orbitable 3D graph (P3).
 *
 * The light is the one `shadeNode`, in the theme's surface (flat: a bullet
 * is the colour it was painted, a dimmed one sinks into the ground). At rest
 * it carries no lift or glow — a bullet looks the same whatever its degree,
 * as it does in the outline — so its emphasis is its presence and the focus
 * swell (`nodeRadius`). A bullet is opaque where
 * the outline's shows (`bullet-paint` composites it over the page's ground),
 * so the sprites depth-test like solids and need no sorting.
 */
import {
  CanvasTexture,
  InstancedBufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Sprite,
  SpriteNodeMaterial,
} from "three/webgpu";
import { float, instancedDynamicBufferAttribute, texture, uv, vec3 } from "three/tsl";
import type { ScenePalette } from "@/scene/palette";
import { bulletExtent, BULLET_GEOMETRY } from "@/lib/bullet-mode";
import { BulletAtlas, bulletAtlasKey, PLAIN_BULLET, readBulletPage } from "@/lib/bullet-atlas";
import { NODE_OPS } from "@/scene/gpu/tsl";
import type { Force3dTopology } from "./force3d-emphasis";
import { shadeNode } from "./force3d-light";
import { baseRadius, nodeRadius, type NodeLayer, type NodeLayerInit } from "./force3d-nodes";

/** A bullet's halo radius, px of its box (the box is 24px, the halo 18px across). */
const HALO_PX = BULLET_GEOMETRY.box / 2 - BULLET_GEOMETRY.haloInset;
/** A bullet's box, as a multiple of its halo's radius. */
const BOX_PER_HALO = BULLET_GEOMETRY.box / HALO_PX;
/**
 * A bullet's halo radius, as a multiple of the sphere the node would be in
 * another theme: the dot inside a bullet is small (4–5px of a 24px box), so
 * the bullet stands larger than a sphere for its dot to read.
 */
const HALO_PER_SPHERE = 2;

/** The page a bullet is painted on, read from the palette and the design system. */
const pageOf = (palette: ScenePalette) => readBulletPage(palette.ink, palette.ground);

const bulletsOf = (nodes: Force3dTopology["nodes"]) => nodes.map((node) => node.bullet);

/** An atlas as a texture: its canvas, sampled with v running up. */
function atlasTexture(atlas: BulletAtlas): CanvasTexture {
  const map = new CanvasTexture(atlas.canvas);
  map.colorSpace = SRGBColorSpace;
  map.minFilter = LinearMipmapLinearFilter;
  map.magFilter = LinearFilter;
  return map;
}

/** Where cell `c` is in the texture, as u, v of its corner and its width and height. */
function textureRect(atlas: BulletAtlas, c: number): [number, number, number, number] {
  const [x, y, w, h] = atlas.cell(c);
  // The canvas's rows run down; a texture's v runs up.
  return [x, 1 - y - h, w, h];
}

export function bulletLayer(init: NodeLayerInit): NodeLayer {
  const { topology, colors, fades, theme } = init;
  const arrival = init.arrival ?? { values: new Float32Array(0) };
  let { palette } = init;
  const n = Math.max(1, topology.nodes.length);
  const place = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const cell = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const presence = new InstancedBufferAttribute(new Float32Array(n), 1);
  const base = new Float32Array(n);
  /** How far each bullet shows, as a share of its halo. */
  const extent = new Float32Array(n);
  // Painted by the first restyle, below.
  let atlas = new BulletAtlas([]);
  let map = atlasTexture(atlas);
  let key: string | null = null;

  const material = new SpriteNodeMaterial();
  const at = instancedDynamicBufferAttribute(place, "vec4");
  const rect = instancedDynamicBufferAttribute(cell, "vec4");
  const present = instancedDynamicBufferAttribute(presence, "float");
  material.positionNode = at.xyz;
  material.scaleNode = at.w;
  const sample = texture(map, rect.xy.add(uv().mul(rect.zw)));
  material.colorNode = shadeNode(
    NODE_OPS,
    {
      hue: vec3(sample.rgb),
      ground: vec3(colors.ground),
      ink: vec3(colors.ink),
      key: float(1),
      rim: float(0),
      presence: present.pow(2),
      glow: float(0),
      lift: float(0),
    },
    theme.scene.surface,
    theme.scene.bloom !== null,
  );
  material.opacityNode = sample.a;
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  const sprite = new Sprite(material);
  sprite.count = topology.nodes.length;
  sprite.frustumCulled = false;

  const paint = () => {
    atlas.paint(pageOf(palette));
    map.needsUpdate = true;
  };
  const restyle = (nodes: Force3dTopology["nodes"]) => {
    nodes.forEach((node, i) => {
      base[i] = baseRadius(node.size);
      extent[i] = bulletExtent(node.bullet ?? PLAIN_BULLET) / HALO_PX;
    });
    // The atlas is painted again only when some bullet's paint changed.
    const bullets = bulletsOf(nodes);
    const next = bulletAtlasKey(bullets);
    if (next === key) return;
    key = next;
    map.dispose();
    atlas = new BulletAtlas(bullets);
    map = atlasTexture(atlas);
    sample.value = map;
    nodes.forEach((_, i) => cell.setXYZW(i, ...textureRect(atlas, atlas.cellOf[i] ?? 0)));
    cell.needsUpdate = true;
    paint();
  };
  restyle(topology.nodes);
  // A glyph painted before the UI face has loaded is painted again once it has.
  if ("fonts" in document) void document.fonts.ready.then(paint);

  const sphere = nodeRadius(topology, fades, arrival, base);
  /** The halo's world radius: twice the sphere, so the small dot reads. */
  const halo = (i: number) => sphere(i) * HALO_PER_SPHERE;
  return {
    mesh: sprite,
    // What picks, frames and labels a bullet: as far as it shows.
    radius: (i) => halo(i) * (extent[i] ?? 1),
    restyle,
    setPalette: (next) => {
      palette = next;
      paint();
    },
    dispose: () => map.dispose(),
    update: (positions) => {
      const p = place.array;
      const e = presence.array;
      for (let i = 0; i < topology.nodes.length; i++) {
        p[i * 4] = positions[i * 3] ?? 0;
        p[i * 4 + 1] = positions[i * 3 + 1] ?? 0;
        p[i * 4 + 2] = positions[i * 3 + 2] ?? 0;
        p[i * 4 + 3] = halo(i) * BOX_PER_HALO;
        e[i] = fades.dim.values[i] ?? 1;
      }
      place.needsUpdate = true;
      presence.needsUpdate = true;
    },
  };
}
