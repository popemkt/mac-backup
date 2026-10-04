/**
 * A graph's bullets in the form a GPU draws them: the outline's bullet
 * (`lib/bullet-mode`) as numbers a shader measures distances to, so a bullet
 * is drawn analytically, crisp at any zoom, by every renderer that draws
 * nodes as bullets (the 2D graphs' sigma program, `sigma-bullets`, and the
 * 3D graph's sprites, `force3d-bullets`).
 *
 * Three things, each stated once and read by both renderers:
 *
 * - **the shape** (`BULLET_UNIFORMS`): the ring, the magnifier and the glyph
 *   box, from `BULLET_GEOMETRY` and `BULLET_QUERY_ICON`, in px of the 24px
 *   box with its centre at the origin and y running down;
 * - **each node's bullet** (`BulletTable`): which mark it is, its halo and
 *   dot radii, where its colours sit in the colour table and how strong each
 *   surface is — and the colour table itself, one row per distinct bullet:
 *   the page's ground, then its ink, ring, halo and dot colours;
 * - **the glyphs** (`BulletGlyphs`): every kind glyph set once in the UI
 *   face as a signed distance field, the one part of a bullet that is type
 *   rather than geometry.
 *
 * A shader lays the marks as the outline does — the halo, then the shape —
 * each over the page's ground where nothing lies under it yet, so a bullet
 * is opaque exactly where the outline's shows (DESIGN-UI.md → The themes).
 */
import {
  BULLET_GEOMETRY,
  BULLET_GLYPH,
  BULLET_GLYPHS,
  BULLET_HALO_RADIUS,
  BULLET_INK,
  BULLET_QUERY_ICON,
  BULLET_SYS_OPACITY,
  bulletAppearance,
  bulletRingDash,
  graphLabelFont,
  queryHandleStart,
  type BulletAppearance,
  type BulletPaint,
  type BulletShape,
} from "@kb/ui-sdk";

/** What the page gives a drawn bullet: its colours and the glyph's face. */
export interface BulletPage {
  /** What `var(--foreground)` is on this page. */
  readonly ink: string;
  /** The page's ground, under every translucent surface. */
  readonly ground: string;
  /** The UI face (`--app-font`), and the size a glyph is set at (`BULLET_GLYPH.size`), px. */
  readonly face: string;
  readonly glyphSize: number;
}

/**
 * The page a graph's bullets are drawn on: its ink and ground as the
 * renderer holds them, and the glyph's face and size read from the design
 * system (the UI face, `BULLET_GLYPH.size`).
 */
export function readBulletPage(ink: string, ground: string): BulletPage {
  const size =
    typeof document === "undefined"
      ? Number.NaN
      : Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(BULLET_GLYPH.size),
        );
  return {
    ink,
    ground,
    face: graphLabelFont("ui"),
    glyphSize: Number.isFinite(size) ? size : 11,
  };
}

/** How a node with no bullet of its own is drawn: a plain leaf. */
export const PLAIN_BULLET: BulletAppearance = bulletAppearance({
  hasChildren: false,
  typeRefs: [],
  tagNames: [],
  isSys: false,
  collapsed: false,
  childCount: 0,
});

type Vec4 = readonly [number, number, number, number];

const { box } = BULLET_GEOMETRY;
/** Box px per magnifier unit: the icon's viewBox drawn `BULLET_GEOMETRY.icon` wide at the centre. */
const ICON = BULLET_GEOMETRY.icon / BULLET_QUERY_ICON.viewBox;
const iconAt = (x: number, y: number) =>
  [(x - BULLET_QUERY_ICON.viewBox / 2) * ICON, (y - BULLET_QUERY_ICON.viewBox / 2) * ICON] as const;

/** Canvas px a glyph's box is set in, and how far its distance field reaches, px of the box. */
const GLYPH_CELL = 512;
const GLYPH_SPREAD = 2.25;

const ring = bulletRingDash();
const lens = iconAt(BULLET_QUERY_ICON.lens.x, BULLET_QUERY_ICON.lens.y);
const handleFrom = queryHandleStart();

/**
 * The shape every bullet shader draws, as its uniforms, px of the box:
 *
 * - `u_bulletRing`: the ring's centre-line radius, half its stroke, one
 *   dash-and-gap period and the dash, as arc lengths from three o'clock;
 * - `u_bulletLens`: the magnifier's lens centre, its radius and half its stroke;
 * - `u_bulletHandle`: the handle's two ends;
 * - `u_bulletGlyph`: how many glyph cells, how far a glyph's field reaches,
 *   and the box a cell spans.
 */
export const BULLET_UNIFORM_NAMES = [
  "u_bulletRing",
  "u_bulletLens",
  "u_bulletHandle",
  "u_bulletGlyph",
] as const;

export type BulletUniform = (typeof BULLET_UNIFORM_NAMES)[number];

export const BULLET_UNIFORMS: Readonly<Record<BulletUniform, Vec4>> = {
  u_bulletRing: [ring.radius, BULLET_GEOMETRY.ring.stroke / 2, ring.dash + ring.gap, ring.dash],
  u_bulletLens: [
    ...lens,
    BULLET_QUERY_ICON.lens.radius * ICON,
    (BULLET_QUERY_ICON.stroke / 2) * ICON,
  ],
  u_bulletHandle: [
    ...iconAt(handleFrom.x, handleFrom.y),
    ...iconAt(BULLET_QUERY_ICON.handle.x, BULLET_QUERY_ICON.handle.y),
  ],
  u_bulletGlyph: [BULLET_GLYPHS.length, GLYPH_SPREAD, box, 0],
};

/**
 * Which mark each shape is drawn by, as the shaders number them: a dot, the
 * dashed ring round a dot, the magnifier, or a glyph (a supertag's `#` is a
 * glyph in its tag's colour).
 */
export const BULLET_MARKS = { dot: 0, ring: 1, magnifier: 2, glyph: 3 } as const;
const MARK_OF: Record<BulletShape, number> = {
  dot: BULLET_MARKS.dot,
  "ref-ring": BULLET_MARKS.ring,
  query: BULLET_MARKS.magnifier,
  supertag: BULLET_MARKS.glyph,
  glyph: BULLET_MARKS.glyph,
};

/** The colour table's fixed columns in every row, before the halo's and dot's colours. */
export const BULLET_TABLE_COLUMNS = { ground: 0, ink: 1, ring: 2, halo: 3 } as const;
/** The tallest table a GPU is sure to take: past it, rows run on in the next column group. */
const MAX_ROWS = 4096;

/** Everything a bullet's drawing depends on, as one string: two bullets alike draw alike. */
export function bulletKey(a: BulletAppearance): string {
  return JSON.stringify([
    a.shape,
    a.glyph,
    a.showHalo,
    a.isSys,
    a.dotSize,
    a.halo,
    a.dot,
    a.ink,
    a.ring,
  ]);
}

/** Every node's bullet, in order: two graphs with the same key draw the same table. */
export function bulletTableKey(bullets: readonly (BulletAppearance | undefined)[]): string {
  return bullets.map((bullet) => bulletKey(bullet ?? PLAIN_BULLET)).join("\n");
}

/** A row's colours, in table order: ring and ink carry one colour, a fill every tag's. */
const rowColors = (a: BulletAppearance): readonly string[] => [
  a.ink.colors[0] ?? BULLET_INK,
  a.ring.colors[0] ?? BULLET_INK,
  ...a.halo.colors,
  ...a.dot.colors,
];

/**
 * A graph's bullets for a shader: per node, four floats in each of three
 * attributes, and the colour table they index.
 *
 * - `mark`: the mark (`BULLET_MARKS`), the halo's radius (0 when it has
 *   none), the dot's radius (0 when it has none) and the glyph's cell (−1);
 * - `paint`: the node's row in the table (its column and row) and how many
 *   colours its halo and its dot divide into;
 * - `alpha`: the strength of its halo, dot, ink and ring (a `sys.*` node's
 *   at half).
 */
export class BulletTable {
  readonly mark: Float32Array;
  readonly paint: Float32Array;
  readonly alpha: Float32Array;
  /** The colour table's size in texels, and each distinct bullet in row order. */
  readonly width: number;
  readonly height: number;
  private readonly rows: BulletAppearance[] = [];
  private readonly groupWidth: number;

  /** One entry per node, in order; a node without a bullet of its own is a plain leaf. */
  constructor(nodes: readonly (BulletAppearance | undefined)[]) {
    const n = nodes.length;
    this.mark = new Float32Array(n * 4);
    this.paint = new Float32Array(n * 4);
    this.alpha = new Float32Array(n * 4);
    const keys = new Map<string, number>();
    const rowOf = nodes.map((node) => {
      const bullet = node ?? PLAIN_BULLET;
      const key = bulletKey(bullet);
      let row = keys.get(key);
      if (row === undefined) {
        row = this.rows.length;
        keys.set(key, row);
        this.rows.push(bullet);
      }
      return row;
    });
    this.groupWidth = Math.max(
      BULLET_TABLE_COLUMNS.halo + 2,
      ...this.rows.map((a) => BULLET_TABLE_COLUMNS.ground + 1 + rowColors(a).length),
    );
    const groups = Math.max(1, Math.ceil(this.rows.length / MAX_ROWS));
    this.width = this.groupWidth * groups;
    this.height = Math.max(1, Math.min(MAX_ROWS, this.rows.length));
    nodes.forEach((node, i) => {
      const a = node ?? PLAIN_BULLET;
      const row = rowOf[i] ?? 0;
      const dim = a.isSys ? BULLET_SYS_OPACITY : 1;
      const drawsDot = a.shape === "dot" || a.shape === "ref-ring";
      const strength = (paint: BulletPaint) => (paint.percent / 100) * dim;
      this.mark.set(
        [
          MARK_OF[a.shape],
          a.showHalo ? BULLET_HALO_RADIUS : 0,
          drawsDot ? a.dotSize / 2 : 0,
          a.glyph === null ? -1 : BULLET_GLYPHS.indexOf(a.glyph),
        ],
        i * 4,
      );
      this.paint.set(
        [
          Math.floor(row / MAX_ROWS) * this.groupWidth,
          row % MAX_ROWS,
          a.halo.colors.length,
          a.dot.colors.length,
        ],
        i * 4,
      );
      this.alpha.set([strength(a.halo), strength(a.dot), strength(a.ink), strength(a.ring)], i * 4);
    });
  }

  /** How many distinct bullets it holds. */
  get distinct(): number {
    return this.rows.length;
  }

  /**
   * Fill `canvas` with the table for this page: each texel one opaque colour,
   * the ink resolved to the page's. A colour the page cannot parse is its ink.
   */
  paintColors(canvas: HTMLCanvasElement, page: Pick<BulletPage, "ink" | "ground">): void {
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, this.width, this.height);
    const texel = (x: number, y: number, color: string) => {
      ctx.fillStyle = page.ink;
      ctx.fillStyle = color === BULLET_INK ? page.ink : color;
      ctx.fillRect(x, y, 1, 1);
    };
    this.rows.forEach((a, row) => {
      const x = Math.floor(row / MAX_ROWS) * this.groupWidth;
      const y = row % MAX_ROWS;
      texel(x + BULLET_TABLE_COLUMNS.ground, y, page.ground);
      rowColors(a).forEach((color, i) => texel(x + BULLET_TABLE_COLUMNS.ink + i, y, color));
    });
  }
}

const INF = 1e20;

/** One line of Felzenszwalb and Huttenlocher's squared distance transform, in place. */
function transformLine(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  scratch: { f: Float64Array; v: Uint32Array; z: Float64Array },
): void {
  const { f, v, z } = scratch;
  for (let q = 0; q < length; q++) f[q] = grid[offset + q * stride] ?? INF;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  let k = 0;
  for (let q = 1; q < length; q++) {
    let s = 0;
    do {
      const r = v[k] ?? 0;
      s = ((f[q] ?? INF) - (f[r] ?? INF) + q * q - r * r) / (q - r) / 2;
    } while (s <= (z[k] ?? -INF) && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < length; q++) {
    while ((z[k + 1] ?? INF) < q) k++;
    const r = v[k] ?? 0;
    grid[offset + q * stride] = (f[r] ?? INF) + (q - r) * (q - r);
  }
}

function transform(grid: Float64Array, width: number, height: number): void {
  const side = Math.max(width, height);
  const scratch = {
    f: new Float64Array(side),
    v: new Uint32Array(side),
    z: new Float64Array(side + 1),
  };
  for (let x = 0; x < width; x++) transformLine(grid, x, width, height, scratch);
  for (let y = 0; y < height; y++) transformLine(grid, y * width, 1, width, scratch);
}

/**
 * A coverage mask's signed distance field: for each pixel, 0.5 on the shape's
 * edge, rising inside and falling outside by 0.5 per `spread` pixels, clamped
 * to 0–1. Coverage is 0–1 per pixel; a partly covered pixel places the edge
 * within it, so the field keeps the rasteriser's subpixel edge.
 */
export function signedDistanceField(
  coverage: Float32Array,
  width: number,
  height: number,
  spread: number,
): Float32Array {
  const outer = new Float64Array(width * height);
  const inner = new Float64Array(width * height);
  coverage.forEach((a, i) => {
    outer[i] = a >= 1 ? 0 : a <= 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    inner[i] = a >= 1 ? INF : a <= 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  });
  transform(outer, width, height);
  transform(inner, width, height);
  const field = new Float32Array(width * height);
  for (let i = 0; i < field.length; i++) {
    const distance = Math.sqrt(outer[i] ?? 0) - Math.sqrt(inner[i] ?? 0);
    field[i] = Math.min(1, Math.max(0, 0.5 - distance / (2 * spread)));
  }
  return field;
}

/**
 * Every kind glyph, set once in the UI face as a signed distance field: one
 * cell per glyph of `BULLET_GLYPHS`, each spanning the bullet's box, the
 * glyph at its centre as the outline sets it. A shader reads the distance
 * and draws the edge at the screen's own resolution, so a glyph stays sharp
 * however near it is drawn. The field is set again only when the face or
 * its size changes, or the face finishes loading.
 */
/** The glyphs last set, by face: a field is costly, and every renderer sets the same. */
let setGlyphs: { readonly key: string; readonly pixels: ImageData } | null = null;

/** Set every kind glyph in `font` on `ctx`'s canvas, and read it back as its distance field. */
function glyphField(ctx: CanvasRenderingContext2D, font: string, scale: number): ImageData {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  BULLET_GLYPHS.forEach((glyph, c) => ctx.fillText(glyph, (c + 0.5) * GLYPH_CELL, GLYPH_CELL / 2));
  const pixels = ctx.getImageData(0, 0, width, height);
  const coverage = new Float32Array(width * height);
  for (let i = 0; i < coverage.length; i++) coverage[i] = (pixels.data[i * 4 + 3] ?? 0) / 255;
  const field = signedDistanceField(coverage, width, height, GLYPH_SPREAD * scale);
  field.forEach((value, i) => {
    const byte = Math.round(value * 255);
    pixels.data.set([byte, byte, byte, 255], i * 4);
  });
  return pixels;
}

export class BulletGlyphs {
  readonly canvas: HTMLCanvasElement;
  /** Bumped on every set: a renderer uploads again when it has not seen this one. */
  version = 0;
  private key: string | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = GLYPH_CELL * BULLET_GLYPHS.length;
    this.canvas.height = GLYPH_CELL;
  }

  /** Set every glyph for `page`, unless it is already set in that face, loaded as now. */
  paint(page: BulletPage): void {
    const scale = GLYPH_CELL / box;
    const font = `${BULLET_GLYPH.weight} ${page.glyphSize * scale}px ${page.face}`;
    const loaded =
      typeof document !== "undefined" && "fonts" in document && document.fonts.check(font);
    const key = `${font}|${loaded}`;
    if (key === this.key) return;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) return;
    this.key = key;
    // One field per face for the session: another renderer in the same face takes it as set.
    if (setGlyphs?.key !== key) setGlyphs = { key, pixels: glyphField(ctx, font, scale) };
    const { pixels } = setGlyphs;
    ctx.putImageData(pixels, 0, 0);
    this.version++;
  }
}
