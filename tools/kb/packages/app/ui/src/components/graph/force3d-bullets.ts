/**
 * The bullet theme's nodes: every node drawn as the outline draws its bullet.
 *
 * What a node's bullet is — its shape, paints and proportions — is the
 * outline's own definition (`lib/bullet-mode`), read off the same outline
 * node (`LensNode.bullet`), and the form a GPU draws it in is
 * `lib/bullet-gpu`'s, which the 2D graphs draw from too: the shape as
 * uniforms, each node's mark, radii and paints, the colour table and the
 * glyphs' distance field. The nodes are one instanced sprite facing the
 * camera: one draw, and the scene stays an orbitable 3D graph (P3). Each
 * fragment measures its distance to the bullet's marks and antialiases it
 * over one screen pixel, so a bullet is sharp however near the camera is.
 *
 * The light is the one `shadeNode`, in the theme's surface (flat: a bullet
 * is the colour it was laid in, a dimmed one sinks into the ground). At rest
 * it carries no lift or glow — a bullet looks the same whatever its degree,
 * as it does in the outline — so its emphasis is its presence and the focus
 * swell (`nodeRadius`). A bullet is opaque where the outline's shows (its
 * marks are laid over the page's ground), so the sprites depth-test like
 * solids and need no sorting.
 */
import {
  CanvasTexture,
  InstancedBufferAttribute,
  LinearFilter,
  NearestFilter,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector4,
} from "three/webgpu";
import {
  abs,
  atan,
  clamp,
  dot,
  float,
  floor,
  fract,
  fwidth,
  instancedDynamicBufferAttribute,
  length,
  max,
  min,
  mix,
  mod,
  select,
  sRGBTransferEOTF,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { bulletExtent, BULLET_GEOMETRY, BULLET_HALO_RADIUS } from "@/lib/bullet-mode";
import {
  BULLET_MARKS,
  BULLET_TABLE_COLUMNS,
  BULLET_UNIFORMS,
  BulletGlyphs,
  BulletTable,
  bulletTableKey,
  PLAIN_BULLET,
  readBulletPage,
} from "@/lib/bullet-gpu";
import { NODE_OPS, type TslNode } from "@/scene/gpu/tsl";
import type { Force3dTopology } from "./force3d-emphasis";
import { shadeNode } from "./force3d-light";
import { baseRadius, nodeRadius, type NodeLayer, type NodeLayerInit } from "./force3d-nodes";

/** A bullet's box, as a multiple of its halo's radius. */
const BOX_PER_HALO = BULLET_GEOMETRY.box / BULLET_HALO_RADIUS;
/**
 * A bullet's halo radius, as a multiple of the sphere the node would be in
 * another theme: the dot inside a bullet is small (4–5px of a 24px box), so
 * the bullet stands larger than a sphere for its dot to read.
 */
const HALO_PER_SPHERE = 2;
const TAU = Math.PI * 2;

/** A canvas as a texture sampled as the canvas lies: rows down, bytes as they are (sRGB). */
function canvasTexture(canvas: HTMLCanvasElement, filter: "nearest" | "linear"): CanvasTexture {
  const map = new CanvasTexture(canvas);
  map.flipY = false;
  map.generateMipmaps = false;
  map.minFilter = filter === "nearest" ? NearestFilter : LinearFilter;
  map.magFilter = filter === "nearest" ? NearestFilter : LinearFilter;
  return map;
}

const vec4Uniform = (value: readonly number[]) =>
  uniform(new Vector4(value[0], value[1], value[2], value[3]));

/** What a bullet's fragment reads: its node's entry, and the colour table and glyphs. */
interface BulletInputs {
  readonly mark: TslNode;
  readonly paint: TslNode;
  readonly alpha: TslNode;
  readonly colors: CanvasTexture;
  readonly glyphs: CanvasTexture;
  readonly tableSize: ReturnType<typeof uniform<Vector2>>;
}

/** Each node's table entry (`BulletTable`) as instance attributes, and their nodes. */
function entryAttributes(n: number) {
  const make = () => new InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const mark = make();
  const paint = make();
  const alpha = make();
  return {
    nodes: {
      mark: instancedDynamicBufferAttribute(mark, "vec4"),
      paint: instancedDynamicBufferAttribute(paint, "vec4"),
      alpha: instancedDynamicBufferAttribute(alpha, "vec4"),
    },
    write(table: BulletTable) {
      for (const [attribute, values] of [
        [mark, table.mark],
        [paint, table.paint],
        [alpha, table.alpha],
      ] as const) {
        attribute.array.set(values);
        attribute.needsUpdate = true;
      }
    },
  };
}

/** Lay a mark of colour `c` at strength `s` over what is there (premultiplied). */
const lay = (under: TslNode, c: TslNode, s: TslNode) => mix(under, vec4(c, 1), s);

/**
 * A bullet's fragment, as the 2D program draws it (`sigma-bullets`): the
 * distance to each of its marks under the shared shape uniforms, each
 * covered over one screen pixel, and laid over the page's ground in the
 * outline's order. `hue` is the laid colour in the scene's linear light,
 * `shown` how much of the fragment the bullet covers, and `tableSamples`
 * every read of the colour table, so a rebuilt table reaches each.
 */
function bulletFragment(inputs: BulletInputs) {
  const { mark, paint, alpha } = inputs;
  const ring = vec4Uniform(BULLET_UNIFORMS.u_bulletRing);
  const lens = vec4Uniform(BULLET_UNIFORMS.u_bulletLens);
  const handle = vec4Uniform(BULLET_UNIFORMS.u_bulletHandle);
  const glyph = vec4Uniform(BULLET_UNIFORMS.u_bulletGlyph);

  // Where this fragment is in the bullet's box (px of the box, centre 0, y
  // down), and how much of the box one screen pixel spans there.
  const p = vec2(uv().x.sub(0.5), float(0.5).sub(uv().y)).mul(glyph.z);
  const pixel = max(fwidth(p.x), fwidth(p.y));
  const cover = (d: TslNode) => clamp(float(0.5).sub(d.div(pixel)), 0, 1);
  /** Every sample of the colour table, so a rebuilt table reaches each. */
  const tableSamples: ReturnType<typeof texture>[] = [];
  const texel = (column: TslNode) => {
    const sample = texture(
      inputs.colors,
      vec2(paint.x.add(column), paint.y).add(0.5).div(inputs.tableSize),
    );
    tableSamples.push(sample);
    return sample.rgb;
  };
  /** Which of n equal wedges, clockwise from the top (CSS conic-gradient's). */
  const wedge = (count: TslNode) =>
    min(floor(fract(atan(p.x, p.y.negate()).div(TAU).add(1)).mul(count)), count.sub(1));
  const r = length(p);
  const angle = atan(p.y, p.x);
  const along = mod(select(angle.lessThan(0), angle.add(TAU), angle).mul(ring.x), ring.z);
  const ringDistance = max(
    abs(r.sub(ring.x)).sub(ring.y),
    abs(along.sub(ring.w.mul(0.5))).sub(ring.w.mul(0.5)),
  );
  const a = p.sub(handle.xy);
  const b = handle.zw.sub(handle.xy);
  const magnifierDistance = min(
    abs(length(p.sub(lens.xy)).sub(lens.z)).sub(lens.w),
    length(a.sub(b.mul(clamp(dot(a, b).div(dot(b, b)), 0, 1)))).sub(lens.w),
  );
  const cell = vec2(p.x.div(glyph.z).add(0.5).add(mark.w).div(glyph.x), p.y.div(glyph.z).add(0.5));
  const glyphDistance = float(0.5).sub(texture(inputs.glyphs, cell).r).mul(glyph.y.mul(2));
  const is = (m: number) => abs(mark.x.sub(m)).lessThan(0.5);

  const halo = select(mark.y.greaterThan(0), cover(r.sub(mark.y)), 0);
  const dotted = select(is(BULLET_MARKS.dot).or(is(BULLET_MARKS.ring)), cover(r.sub(mark.z)), 0);
  const ringed = select(is(BULLET_MARKS.ring), cover(ringDistance), 0);
  const inked = select(
    is(BULLET_MARKS.magnifier),
    cover(magnifierDistance),
    select(is(BULLET_MARKS.glyph), cover(glyphDistance), 0),
  );
  const shown = max(max(halo, dotted), max(ringed, inked));
  // The page's ground lies under the bullet wherever it shows; the halo, the
  // ring, the dot and the ink are laid over it in the outline's order, in
  // sRGB as the outline composites, then taken to the scene's linear light.
  const C = BULLET_TABLE_COLUMNS;
  let laid: TslNode = vec4(texel(float(C.ground)).mul(shown), shown);
  laid = lay(laid, texel(float(C.halo).add(wedge(paint.z))), alpha.x.mul(halo));
  laid = lay(laid, texel(float(C.ring)), alpha.w.mul(ringed));
  laid = lay(laid, texel(float(C.halo).add(paint.z).add(wedge(paint.w))), alpha.y.mul(dotted));
  laid = lay(laid, texel(float(C.ink)), alpha.z.mul(inked));
  const hue = sRGBTransferEOTF(laid.rgb.div(max(laid.a, 1e-4)));
  return { hue, shown, tableSamples };
}

export function bulletLayer(init: NodeLayerInit): NodeLayer {
  const { topology, fades, theme, colors } = init;
  const arrival = init.arrival ?? { values: new Float32Array(0) };
  let { palette } = init;
  const n = Math.max(1, topology.nodes.length);
  const place = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const presence = new InstancedBufferAttribute(new Float32Array(n), 1);
  const entries = entryAttributes(n);
  const base = new Float32Array(n);
  /** How far each bullet shows, as a share of its halo. */
  const extent = new Float32Array(n);
  // Built by the first restyle, below.
  let table = new BulletTable([]);
  let key: string | null = null;
  const colorCanvas = document.createElement("canvas");
  let colorMap = canvasTexture(colorCanvas, "nearest");
  const glyphs = new BulletGlyphs();
  const glyphMap = canvasTexture(glyphs.canvas, "linear");
  let glyphVersion = -1;

  const material = new SpriteNodeMaterial();
  const at = instancedDynamicBufferAttribute(place, "vec4");
  const present = instancedDynamicBufferAttribute(presence, "float");
  material.positionNode = at.xyz;
  material.scaleNode = at.w;

  const tableSize = uniform(new Vector2(1, 1));
  const { hue, shown, tableSamples } = bulletFragment({
    ...entries.nodes,
    colors: colorMap,
    glyphs: glyphMap,
    tableSize,
  });

  material.colorNode = shadeNode(
    NODE_OPS,
    {
      hue: vec3(hue),
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
  material.opacityNode = shown;
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  const sprite = new Sprite(material);
  sprite.count = topology.nodes.length;
  sprite.frustumCulled = false;

  /** Paint the colour table for the palette, and set the glyphs if their face changed or loaded. */
  const paintPage = () => {
    table.paintColors(colorCanvas, palette);
    colorMap.needsUpdate = true;
    glyphs.paint(readBulletPage(palette.ink, palette.ground));
    if (glyphs.version !== glyphVersion) {
      glyphVersion = glyphs.version;
      glyphMap.needsUpdate = true;
    }
  };
  const restyle = (nodes: Force3dTopology["nodes"]) => {
    nodes.forEach((node, i) => {
      base[i] = baseRadius(node.size);
      extent[i] = bulletExtent(node.bullet ?? PLAIN_BULLET) / BULLET_HALO_RADIUS;
    });
    // The table is built and painted again only when some bullet changed.
    const bullets = nodes.map((node) => node.bullet);
    const next = bulletTableKey(bullets);
    if (next === key) return;
    key = next;
    table = new BulletTable(bullets);
    entries.write(table);
    tableSize.value.set(table.width, table.height);
    // A table of another size is another texture.
    colorMap.dispose();
    colorMap = canvasTexture(colorCanvas, "nearest");
    for (const sample of tableSamples) sample.value = colorMap;
    paintPage();
  };
  restyle(topology.nodes);
  // A glyph set before the UI face has loaded is set again once it has.
  if ("fonts" in document) void document.fonts.ready.then(paintPage);

  const sphere = nodeRadius(topology, fades, arrival, base);
  /** The halo's world radius: twice the sphere, so the small dot reads. */
  const haloRadius = (i: number) => sphere(i) * HALO_PER_SPHERE;
  return {
    mesh: sprite,
    // What picks, frames and labels a bullet: as far as it shows.
    radius: (i) => haloRadius(i) * (extent[i] ?? 1),
    restyle,
    setPalette: (next) => {
      palette = next;
      paintPage();
    },
    dispose: () => {
      colorMap.dispose();
      glyphMap.dispose();
    },
    update: (positions) => {
      const q = place.array;
      const e = presence.array;
      for (let i = 0; i < topology.nodes.length; i++) {
        q[i * 4] = positions[i * 3] ?? 0;
        q[i * 4 + 1] = positions[i * 3 + 1] ?? 0;
        q[i * 4 + 2] = positions[i * 3 + 2] ?? 0;
        q[i * 4 + 3] = haloRadius(i) * BOX_PER_HALO;
        e[i] = fades.dim.values[i] ?? 1;
      }
      place.needsUpdate = true;
      presence.needsUpdate = true;
    },
  };
}
