import { cn } from "@/lib/cn";
import {
  BULLET_GEOMETRY,
  BULLET_GLYPH,
  BULLET_QUERY_ICON,
  BULLET_SYS_OPACITY,
  bulletPaintCss,
  bulletRingDash,
  outlineBulletAppearance,
  queryIconPath,
  type BulletAppearance,
  type OutlineBulletOptions,
  type BulletShape,
} from "@/lib/bullet-mode";
import type { OutlineNode } from "@/lib/types";

interface BulletProps extends OutlineBulletOptions {
  node: OutlineNode;
  onClick: (e: React.MouseEvent) => void;
}

/**
 * DESIGN-RESKIN §1.8 — the bullet draws `bulletAppearance`'s record and
 * decides nothing: which shape, every surface's paint (a node's tag colours,
 * or the ink at a stated strength) and every part's size are the record's
 * (`lib/bullet-mode`). Only the hover affordance is the DOM's own; it wins
 * over the painted ink (`!`), as it did over the ink classes.
 */
/** A glyph's type, from the definition. */
const GLYPH_TYPE = { fontSize: `var(${BULLET_GLYPH.size})`, fontWeight: BULLET_GLYPH.weight };

function SupertagGlyph({ a }: { a: BulletAppearance }) {
  return (
    <span
      className={cn(
        "relative z-[1] block select-none leading-none",
        a.hasChildren && !a.collapsed && !a.tinted && "group-hover/bullet:text-foreground/70!",
      )}
      style={{ ...GLYPH_TYPE, color: bulletPaintCss(a.ink) }}
      aria-hidden
    >
      {a.glyph}
    </span>
  );
}

function QueryGlyph({ a }: { a: BulletAppearance }) {
  const { viewBox, stroke } = BULLET_QUERY_ICON;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={BULLET_GEOMETRY.icon}
      height={BULLET_GEOMETRY.icon}
      fill="none"
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      className="relative z-[1]"
      style={{ color: bulletPaintCss(a.ink) }}
      data-bullet-query
    >
      <path d={queryIconPath()} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}

/** The ring's dashes, fitted to its circle once: the same for every ring. */
const RING_DASH = bulletRingDash();

function RefRing({ a }: { a: BulletAppearance }) {
  const { size, stroke } = BULLET_GEOMETRY.ring;
  return (
    <span
      className="relative z-[1] flex items-center justify-center"
      style={{ width: size, height: size }}
      data-bullet-ref-ring
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        className="absolute inset-0"
        style={{ color: bulletPaintCss(a.ring) }}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={RING_DASH.radius}
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={`${RING_DASH.dash} ${RING_DASH.gap}`}
        />
      </svg>
      <span
        className="relative block rounded-full"
        style={{ width: a.dotSize, height: a.dotSize, background: bulletPaintCss(a.dot) }}
        data-bullet-dot
      />
    </span>
  );
}

function KindGlyph({ a }: { a: BulletAppearance }) {
  return (
    <span
      className="relative z-[1] select-none leading-none"
      style={{ ...GLYPH_TYPE, color: bulletPaintCss(a.ink) }}
      aria-hidden
    >
      {a.glyph}
    </span>
  );
}

function Dot({ a }: { a: BulletAppearance }) {
  return (
    <span
      className={cn(
        "relative z-[1] block rounded-full transition-all duration-100",
        a.hasChildren && !a.collapsed && !a.tinted && "group-hover/bullet:bg-foreground/60!",
      )}
      style={{ width: a.dotSize, height: a.dotSize, background: bulletPaintCss(a.dot) }}
      data-bullet-dot
    />
  );
}

/** One row per shape, keyed by the union — a new shape fails the build. */
const BULLET_SHAPES: Record<BulletShape, (props: { a: BulletAppearance }) => React.ReactNode> = {
  supertag: SupertagGlyph,
  query: QueryGlyph,
  "ref-ring": RefRing,
  glyph: KindGlyph,
  dot: Dot,
};

export function Bullet({ node, onClick, ...options }: BulletProps) {
  const appearance = outlineBulletAppearance(node, options);
  const Shape = BULLET_SHAPES[appearance.shape];

  const bullet = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bullet-container group/bullet relative flex h-6 w-6 shrink-0 items-center justify-center",
        "rounded-sm hover:bg-foreground/5 transition-colors duration-100",
        "cursor-pointer",
      )}
      style={appearance.isSys ? { opacity: BULLET_SYS_OPACITY } : undefined}
      tabIndex={-1}
      data-bullet-kind={appearance.kind}
      data-bullet-ref={appearance.isRef ? "true" : undefined}
      data-bullet-sys={appearance.isSys ? "true" : undefined}
      title={appearance.title}
      aria-label={appearance.ariaLabel}
    >
      {appearance.showHalo && (
        <span
          className="absolute rounded-full"
          style={{
            inset: BULLET_GEOMETRY.haloInset,
            background: bulletPaintCss(appearance.halo),
          }}
          data-bullet-halo
        />
      )}

      <Shape a={appearance} />
    </button>
  );
  if (!appearance.showCount) return bullet;
  // The count sits beside the bullet, in the indent gutter, not over its
  // corner; outside the button, so the bullet's hover tint never lies under it.
  return (
    <span className="relative inline-flex shrink-0">
      {bullet}
      <span
        className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 pr-0.5 text-micro font-medium tabular-nums text-muted-foreground"
        data-bullet-count
      >
        {appearance.childCount}
      </span>
    </span>
  );
}
