/**
 * A bullet, painted on a canvas: the canvas renderer of `BulletAppearance`
 * (`lib/bullet-mode`), as the outline's `Bullet` is its DOM renderer. It
 * decides nothing — the shape, every surface's paint and every part's size
 * are the record's — so a bullet changed there changes here too.
 *
 * The one thing a canvas must add is the page: the outline's translucent
 * surfaces (a halo at 12.5%, the ink at 40%) are seen over the page's
 * ground, so the first surface is painted over that ground (a later one
 * over what is already there, as in the DOM), and the bullet is opaque
 * exactly where the outline's shows and clear everywhere else.
 */
import {
  BULLET_GEOMETRY,
  BULLET_GLYPH,
  BULLET_INK,
  BULLET_QUERY_ICON,
  BULLET_SYS_OPACITY,
  bulletRingDash,
  queryIconPath,
  type BulletAppearance,
  type BulletPaint,
} from "@/lib/bullet-mode";

/** What the page gives a painted bullet: its colours and the glyph's face. */
export interface BulletPage {
  /** What `var(--foreground)` is on this page. */
  readonly ink: string;
  /** The page's ground, under every translucent surface. */
  readonly ground: string;
  /** The UI face (`--app-font`), and the size a glyph is set at (`BULLET_GLYPH.size`), px. */
  readonly face: string;
  readonly glyphSize: number;
}

type Ctx = CanvasRenderingContext2D;

/** How one bullet is being painted: its page, its strength, and whether a surface lies under it yet. */
interface Brush {
  readonly page: BulletPage;
  readonly dim: number;
  grounded: boolean;
}

const CENTRE = BULLET_GEOMETRY.box / 2;

/** A paint's colours on this page (the ink resolved). */
const colorsOf = (paint: BulletPaint, page: BulletPage) =>
  paint.colors.map((color) => (color === BULLET_INK ? page.ink : color));

/** The fill a paint lays on a disc at the centre: one colour, or equal wedges from the top. */
function fillOf(ctx: Ctx, paint: BulletPaint, page: BulletPage): string | CanvasGradient {
  const colors = colorsOf(paint, page);
  const [only] = colors;
  if (colors.length === 1 && only !== undefined) return only;
  // CSS `conic-gradient(from 0deg, …)` starts at the top and turns clockwise.
  const wedges = ctx.createConicGradient(-Math.PI / 2, CENTRE, CENTRE);
  colors.forEach((color, i) => {
    wedges.addColorStop(i / colors.length, color);
    wedges.addColorStop((i + 1) / colors.length, color);
  });
  return wedges;
}

type Style = string | CanvasGradient;

/**
 * Lay one mark in `style` at `percent` — every surface of a bullet, filled
 * or stroked, goes through here: over the page's ground when nothing lies
 * under it yet, over what does when something does (a halo). `mark` draws
 * the shape in the style it is handed.
 */
function lay(ctx: Ctx, brush: Brush, style: Style, percent: number, mark: (s: Style) => void) {
  if (!brush.grounded) {
    ctx.globalAlpha = 1;
    mark(brush.page.ground);
  }
  ctx.globalAlpha = (percent / 100) * brush.dim;
  mark(style);
  ctx.globalAlpha = 1;
}

/** A disc of `paint` at the centre. */
function disc(ctx: Ctx, radius: number, paint: BulletPaint, brush: Brush): void {
  ctx.beginPath();
  ctx.arc(CENTRE, CENTRE, radius, 0, Math.PI * 2);
  lay(ctx, brush, fillOf(ctx, paint, brush.page), paint.percent, (style) => {
    ctx.fillStyle = style;
    ctx.fill();
  });
}

/** Text or a path in `paint`'s first colour (a stroke or a glyph carries one). */
function inked(ctx: Ctx, paint: BulletPaint, brush: Brush, draw: () => void) {
  lay(ctx, brush, colorsOf(paint, brush.page)[0] ?? brush.page.ink, paint.percent, (style) => {
    ctx.fillStyle = style;
    draw();
  });
}

function glyph(ctx: Ctx, text: string, a: BulletAppearance, brush: Brush) {
  ctx.font = `${BULLET_GLYPH.weight} ${brush.page.glyphSize}px ${brush.page.face}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  inked(ctx, a.ink, brush, () => ctx.fillText(text, CENTRE, CENTRE));
}

const SHAPES: Record<
  BulletAppearance["shape"],
  (ctx: Ctx, a: BulletAppearance, brush: Brush) => void
> = {
  dot: (ctx, a, brush) => disc(ctx, a.dotSize / 2, a.dot, brush),
  supertag: (ctx, a, brush) => glyph(ctx, a.glyph ?? "", a, brush),
  glyph: (ctx, a, brush) => glyph(ctx, a.glyph ?? "", a, brush),
  query: (ctx, a, brush) => {
    const { icon } = BULLET_GEOMETRY;
    const { viewBox, stroke } = BULLET_QUERY_ICON;
    const shape = new Path2D(queryIconPath());
    ctx.save();
    ctx.translate(CENTRE - icon / 2, CENTRE - icon / 2);
    ctx.scale(icon / viewBox, icon / viewBox);
    ctx.lineWidth = stroke;
    ctx.lineCap = "round";
    const color = colorsOf(a.ink, brush.page)[0] ?? brush.page.ink;
    lay(ctx, brush, color, a.ink.percent, (style) => {
      ctx.strokeStyle = style;
      ctx.stroke(shape);
    });
    ctx.restore();
  },
  "ref-ring": (ctx, a, brush) => {
    const { radius, dash, gap } = bulletRingDash();
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, radius, 0, Math.PI * 2);
    ctx.setLineDash([dash, gap]);
    ctx.lineWidth = BULLET_GEOMETRY.ring.stroke;
    const color = colorsOf(a.ring, brush.page)[0] ?? brush.page.ink;
    lay(ctx, brush, color, a.ring.percent, (style) => {
      ctx.strokeStyle = style;
      ctx.stroke();
    });
    ctx.setLineDash([]);
    disc(ctx, a.dotSize / 2, a.dot, brush);
  },
};

/**
 * Paint `a` into the square at (`x`, `y`) of side `size` canvas pixels: the
 * bullet's 24px box scaled to fill it, its halo first, its shape over it.
 */
export function paintBullet(
  ctx: Ctx,
  a: BulletAppearance,
  at: { readonly x: number; readonly y: number; readonly size: number },
  page: BulletPage,
): void {
  const brush: Brush = { page, dim: a.isSys ? BULLET_SYS_OPACITY : 1, grounded: false };
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(at.size / BULLET_GEOMETRY.box, at.size / BULLET_GEOMETRY.box);
  if (a.showHalo) {
    disc(ctx, CENTRE - BULLET_GEOMETRY.haloInset, a.halo, brush);
    brush.grounded = true;
  }
  SHAPES[a.shape](ctx, a, brush);
  ctx.restore();
}

/**
 * Everything a bullet's paint depends on, as one string: two bullets with the
 * same key paint the same pixels, so a painted bullet can be shared.
 */
export function bulletPaintKey(a: BulletAppearance): string {
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
