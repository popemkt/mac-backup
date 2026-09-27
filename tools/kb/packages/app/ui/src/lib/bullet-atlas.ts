/**
 * A graph's bullets, each distinct one painted once into one canvas: the
 * atlas every renderer that draws nodes as the outline's bullets samples
 * (the 3D graph as a texture on its sprites, the 2D graphs as a texture on
 * sigma's nodes). What a bullet is stays `lib/bullet-mode`'s, and how it is
 * painted `lib/bullet-paint`'s; this only lays the cells out and paints them.
 */
import { BULLET_GLYPH, bulletAppearance, type BulletAppearance } from "@/lib/bullet-mode";
import { bulletPaintKey, paintBullet, type BulletPage } from "@/lib/bullet-paint";
import { graphLabelFont } from "@/lib/graph-label";

/** Canvas pixels a bullet's box is painted at, and the clear margin round it (mip bleed). */
const CELL = 128;
const PAD = 16;
const COLUMNS = 16;
/** The widest atlas a GPU is sure to take. */
const MAX_SIDE = 4096;

/** How a node with no bullet of its own is drawn: a plain leaf. */
export const PLAIN_BULLET: BulletAppearance = bulletAppearance({
  hasChildren: false,
  typeRefs: [],
  tagNames: [],
  isSys: false,
  collapsed: false,
  childCount: 0,
});

/**
 * The page a graph's bullets are painted on: its ink and ground as the
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

/** Every node's paint, in order: two graphs with the same key paint the same atlas. */
export function bulletAtlasKey(bullets: readonly (BulletAppearance | undefined)[]): string {
  return bullets.map((bullet) => bulletPaintKey(bullet ?? PLAIN_BULLET)).join("\n");
}

/** Each distinct bullet of a graph, painted once into one canvas. */
export class BulletAtlas {
  readonly canvas = document.createElement("canvas");
  /** Each node's cell. */
  readonly cellOf: Uint16Array;
  private readonly bullets: BulletAppearance[] = [];

  /** How many distinct bullets it holds. */
  get cells(): number {
    return this.bullets.length;
  }

  /** One entry per node, in order; a node without a bullet of its own is a plain leaf. */
  constructor(nodes: readonly (BulletAppearance | undefined)[]) {
    const keys = new Map<string, number>();
    const capacity = COLUMNS * Math.floor(MAX_SIDE / (CELL + PAD * 2));
    this.cellOf = new Uint16Array(nodes.length);
    nodes.forEach((node, i) => {
      const bullet = node ?? PLAIN_BULLET;
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
  }

  /**
   * Where cell `c` is on the canvas, as shares of its width and height: the
   * left and top of its box, and the box's width and height. Rows run down,
   * as the canvas's do; a renderer whose texture's v runs up flips it.
   */
  cell(c: number): [number, number, number, number] {
    const side = CELL + PAD * 2;
    const { width, height } = this.canvas;
    const col = c % COLUMNS;
    const row = Math.floor(c / COLUMNS);
    return [(col * side + PAD) / width, (row * side + PAD) / height, CELL / width, CELL / height];
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
  }
}
