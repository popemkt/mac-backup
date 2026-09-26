import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import {
  BULLET_GEOMETRY,
  BULLET_SYS_OPACITY,
  bulletPaintCss,
  outlineBulletAppearance,
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
function SupertagGlyph({ a }: { a: BulletAppearance }) {
  return (
    <span
      className={cn(
        "relative z-[1] block select-none text-label font-bold leading-none",
        a.hasChildren && !a.collapsed && !a.tinted && "group-hover/bullet:text-foreground/70!",
      )}
      style={{ color: bulletPaintCss(a.ink) }}
      aria-hidden
    >
      #
    </span>
  );
}

function QueryGlyph({ a }: { a: BulletAppearance }) {
  return (
    <MagnifyingGlassIcon
      size={BULLET_GEOMETRY.icon}
      weight="bold"
      className="relative z-[1]"
      style={{ color: bulletPaintCss(a.ink) }}
      data-bullet-query
    />
  );
}

function RefRing({ a }: { a: BulletAppearance }) {
  return (
    <span
      className="relative z-[1] flex items-center justify-center rounded-full border border-dashed"
      style={{
        width: BULLET_GEOMETRY.ring,
        height: BULLET_GEOMETRY.ring,
        borderColor: bulletPaintCss(a.ring),
      }}
      data-bullet-ref-ring
    >
      <span
        className="block rounded-full"
        style={{ width: a.dotSize, height: a.dotSize, background: bulletPaintCss(a.dot) }}
        data-bullet-dot
      />
    </span>
  );
}

function KindGlyph({ a }: { a: BulletAppearance }) {
  return (
    <span
      className="relative z-[1] select-none text-label font-bold leading-none"
      style={{ color: bulletPaintCss(a.ink) }}
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
