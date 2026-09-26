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
import {
  bulletAppearance,
  bulletExtent,
  BULLET_GEOMETRY,
  BULLET_GLYPH,
  type BulletAppearance,
} from "@/lib/bullet-mode";
import { bulletPaintKey, paintBullet, type BulletPage } from "@/lib/bullet-paint";
import { graphLabelFont } from "@/lib/graph-label";
import { NODE_OPS } from "@/scene/gpu/tsl";
import type { Force3dTopology } from "./force3d-emphasis";
import { shadeNode } from "./force3d-light";
import { baseRadius, nodeRadius, type NodeLayer, type NodeLayerInit } from "./force3d-nodes";

/** Canvas pixels a bullet's box is painted at, and the clear margin round it (mip bleed). */
const CELL = 128;
const PAD = 16;
const COLUMNS = 16;
/** The widest atlas a GPU is sure to take. */
const MAX_SIDE = 4096;
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
/** How a node with no bullet of its own is drawn: a plain leaf. */
const PLAIN = bulletAppearance({
  hasChildren: false,
  typeRefs: [],
  tagNames: [],
  isSys: false,
  collapsed: false,
  childCount: 0,
});

/** The page a bullet is painted on, read from the palette and the design system. */
function pageOf(palette: ScenePalette): BulletPage {
  const size =
    typeof document === "undefined"
      ? Number.NaN
      : Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(BULLET_GLYPH.size),
        );
  return {
    ink: palette.ink,
    ground: palette.ground,
    face: graphLabelFont("ui"),
    glyphSize: Number.isFinite(size) ? size : 11,
  };
}

/** What a node is drawn as: its own bullet, or a plain leaf. */
const bulletOf = (node: Force3dTopology["nodes"][number]) => node.bullet ?? PLAIN;

/** Every node's paint, in order: two graphs with the same key paint the same atlas. */
function atlasKey(nodes: Force3dTopology["nodes"]): string {
  return nodes.map((node) => bulletPaintKey(bulletOf(node))).join("\n");
}

/** Each distinct bullet of a graph, painted once into one texture. */
export class BulletAtlas {
  readonly canvas = document.createElement("canvas");
  readonly texture = new CanvasTexture(this.canvas);
  /** Each node's cell. */
  readonly cellOf: Uint16Array;
  private readonly bullets: BulletAppearance[] = [];

  /** How many distinct bullets it holds. */
  get cells(): number {
    return this.bullets.length;
  }

  constructor(nodes: Force3dTopology["nodes"]) {
    const keys = new Map<string, number>();
    const capacity = COLUMNS * Math.floor(MAX_SIDE / (CELL + PAD * 2));
    this.cellOf = new Uint16Array(nodes.length);
    nodes.forEach((node, i) => {
      const bullet = bulletOf(node);
      const key = bulletPaintKey(bullet);
      let cell = keys.get(key);
      if (cell === undefined && this.bullets.length < capacity) {
        cell = this.bullets.length;
        keys.set(key, cell);
        this.bullets.push(bullet);
      }
      // GAP [[01M3FNF3PFQA9J4XM76G3K7P9A]] — past the atlas's capacity a bullet shares the first cell.
      this.cellOf[i] = cell ?? 0;
    });
    const side = CELL + PAD * 2;
    this.canvas.width = COLUMNS * side;
    this.canvas.height = Math.max(1, Math.ceil(Math.max(1, this.bullets.length) / COLUMNS)) * side;
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
  }

  /** Where cell `c` is in the texture, as u, v of its corner and its width and height. */
  rect(c: number): [number, number, number, number] {
    const side = CELL + PAD * 2;
    const { width, height } = this.canvas;
    const col = c % COLUMNS;
    const row = Math.floor(c / COLUMNS);
    const u = (col * side + PAD) / width;
    // The canvas's rows run down; a texture's v runs up.
    const v = 1 - (row * side + PAD + CELL) / height;
    return [u, v, CELL / width, CELL / height];
  }

  /** Paint every bullet for this page. */
  paint(page: BulletPage): void {
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const side = CELL + PAD * 2;
    this.bullets.forEach((bullet, c) => {
      const x = (c % COLUMNS) * side + PAD;
      const y = Math.floor(c / COLUMNS) * side + PAD;
      paintBullet(ctx, bullet, { x, y, size: CELL }, page);
    });
    this.texture.needsUpdate = true;
  }
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
  let key: string | null = null;

  const material = new SpriteNodeMaterial();
  const at = instancedDynamicBufferAttribute(place, "vec4");
  const rect = instancedDynamicBufferAttribute(cell, "vec4");
  const present = instancedDynamicBufferAttribute(presence, "float");
  material.positionNode = at.xyz;
  material.scaleNode = at.w;
  const map = texture(atlas.texture, rect.xy.add(uv().mul(rect.zw)));
  material.colorNode = shadeNode(
    NODE_OPS,
    {
      hue: vec3(map.rgb),
      ground: vec3(colors.ground),
      ink: vec3(colors.ink),
      key: float(1),
      rim: float(0),
      presence: present.pow(2),
      glow: float(0),
      lift: float(0),
    },
    theme.surface,
    theme.bloom !== null,
  );
  material.opacityNode = map.a;
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  const sprite = new Sprite(material);
  sprite.count = topology.nodes.length;
  sprite.frustumCulled = false;

  const paint = () => atlas.paint(pageOf(palette));
  const restyle = (nodes: Force3dTopology["nodes"]) => {
    nodes.forEach((node, i) => {
      base[i] = baseRadius(node.size);
      extent[i] = bulletExtent(bulletOf(node)) / HALO_PX;
    });
    // The atlas is painted again only when some bullet's paint changed.
    const next = atlasKey(nodes);
    if (next === key) return;
    key = next;
    atlas.texture.dispose();
    atlas = new BulletAtlas(nodes);
    map.value = atlas.texture;
    nodes.forEach((_, i) => cell.setXYZW(i, ...atlas.rect(atlas.cellOf[i] ?? 0)));
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
    dispose: () => atlas.texture.dispose(),
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
