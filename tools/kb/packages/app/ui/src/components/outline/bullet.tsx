import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { BulletAppearance, BulletKindOverride, BulletShape } from "@/lib/bullet-mode";
import { bulletAppearance } from "@/lib/bullet-mode";
import { typeRefsOf } from "@kb/model";
import { nodeTagColors } from "@/lib/tag-color";
import { isSysPrefixed, type OutlineNode } from "@/lib/types";
import { hasText } from "@/lib/text";

interface BulletProps {
  node: OutlineNode;
  /** True when node has children, fields, or is a query node. */
  collapsible?: boolean;
  /** Reference-row state (query result / embedded ref) — dashed ring. */
  isRef?: boolean;
  /** W6 stubs: force media/canvas glyph before those tags exist. */
  kindOverride?: BulletKindOverride | null;
  onClick: (e: React.MouseEvent) => void;
}

/**
 * DESIGN-RESKIN §1.8 — a node's tag colouring is a list. Filled surfaces
 * (halo, dot) divide equally from the center; a stroke or a glyph can only
 * carry one color, so those take the first tag's. Which surface is which is
 * `bulletAppearance`'s answer; these render it.
 */
function SupertagGlyph({ a }: { a: BulletAppearance }) {
  return (
    <span
      className={cn(
        "relative z-[1] block select-none text-[11px] font-bold leading-none",
        !a.tinted && "text-foreground/45",
        !a.tinted && a.hasChildren && "text-foreground/55",
        a.hasChildren && !a.collapsed && !a.tinted && "group-hover/bullet:text-foreground/70",
      )}
      style={hasText(a.strokeColor) ? { color: a.strokeColor } : undefined}
      aria-hidden
    >
      #
    </span>
  );
}

function QueryGlyph({ a }: { a: BulletAppearance }) {
  return (
    <MagnifyingGlassIcon
      size={14}
      weight="bold"
      className={cn("relative z-[1]", !a.tinted && "text-foreground/45")}
      style={hasText(a.strokeColor) ? { color: a.strokeColor } : undefined}
      data-bullet-query
    />
  );
}

function RefRing({ a }: { a: BulletAppearance }) {
  return (
    <span
      className={cn(
        "relative z-[1] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-dashed",
        !a.tinted && "border-foreground/20",
      )}
      style={hasText(a.ringColor) ? { borderColor: a.ringColor } : undefined}
      data-bullet-ref-ring
    >
      <span
        className={cn(
          "block rounded-full",
          a.hasChildren ? "h-[5px] w-[5px]" : "h-[4px] w-[4px]",
          !a.tinted && "bg-foreground/40",
          !a.tinted && a.hasChildren && "bg-foreground/55",
        )}
        style={hasText(a.dotFill) ? { background: a.dotFill } : undefined}
        data-bullet-dot
      />
    </span>
  );
}

function KindGlyph({ a }: { a: BulletAppearance }) {
  return (
    <span
      className={cn(
        "relative z-[1] select-none text-[11px] font-bold leading-none",
        "text-foreground/45",
      )}
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
        a.hasChildren ? "h-[5px] w-[5px]" : "h-[4px] w-[4px]",
        !a.tinted && "bg-foreground/40",
        !a.tinted && a.hasChildren && "bg-foreground/50",
        a.hasChildren && !a.collapsed && !a.tinted && "group-hover/bullet:bg-foreground/60",
      )}
      style={hasText(a.dotFill) ? { background: a.dotFill } : undefined}
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

export function Bullet({
  node,
  collapsible,
  isRef = false,
  kindOverride = null,
  onClick,
}: BulletProps) {
  const appearance = bulletAppearance({
    hasChildren: node.children.length > 0,
    typeRefs: typeRefsOf(node),
    tagNames: node.tags.map((t) => t.name),
    fieldIds: Object.keys(node.props),
    isSys: isSysPrefixed(node.id),
    text: node.text,
    kindOverride,
    collapsed: node.collapsed,
    childCount: node.children.length,
    isRef,
    collapsible,
    tagColors: nodeTagColors(node),
  });
  const Shape = BULLET_SHAPES[appearance.shape];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bullet-container group/bullet relative flex h-6 w-6 shrink-0 items-center justify-center",
        "rounded-sm hover:bg-foreground/5 transition-colors duration-100",
        "cursor-pointer",
        appearance.isSys && "opacity-50",
      )}
      tabIndex={-1}
      data-bullet-kind={appearance.kind}
      data-bullet-ref={appearance.isRef ? "true" : undefined}
      data-bullet-sys={appearance.isSys ? "true" : undefined}
      title={appearance.title}
      aria-label={appearance.ariaLabel}
    >
      {appearance.showHalo && (
        <span
          className="absolute rounded-full bg-foreground/8"
          style={{ inset: "3px", background: appearance.haloFill ?? undefined }}
          data-bullet-halo
        />
      )}

      <Shape a={appearance} />

      {appearance.showCount && (
        <span
          className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/10 px-0.5 text-[9px] font-medium text-foreground/50"
          data-bullet-count
        >
          {appearance.childCount}
        </span>
      )}
    </button>
  );
}
