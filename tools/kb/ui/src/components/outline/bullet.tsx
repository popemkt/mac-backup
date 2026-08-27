import { MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { BulletKind, BulletKindOverride } from "@/lib/bullet-mode";
import { resolveBulletMode } from "@/lib/bullet-mode";
import { typeRefsOf } from "@kb/ontology";
import { nodeTagColors, tagColorAlpha, tagColorFill } from "@/lib/tag-color";
import { isSysPrefixed, type OutlineNode } from "@/lib/types";

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

const KIND_GLYPH: Partial<Record<BulletKind, string>> = {
  tag: "#",
  field: "\u2317",
  command: "\u2699",
  media: "\u25A3",
  canvas: "\u25C7",
  ontology: "\u2B21",
};

/** DESIGN-RESKIN §1.3 — collapsed halo is the tag color at 12.5% (was `20`). */
const HALO_OPACITY = 12.5;
/** Dashed reference ring stroke at 25% (was `40`). */
const REF_RING_OPACITY = 25;

export function Bullet({
  node,
  collapsible: collapsibleProp,
  isRef = false,
  kindOverride = null,
  onClick,
}: BulletProps) {
  const hasChildren = node.children.length > 0;
  const mode = resolveBulletMode({
    hasChildren,
    typeRefs: typeRefsOf(node),
    tagNames: node.tags.map((t) => t.name),
    isSys: isSysPrefixed(node.id),
    text: node.text,
    kindOverride,
    collapsed: node.collapsed,
    childCount: node.children.length,
    isRef,
  });

  // DESIGN-RESKIN §1.8 — a node's tag colouring is a list. Filled surfaces
  // (halo, dot) divide equally from the center; a stroke or a glyph can only
  // carry one color, so those take the first tag's.
  const tagColors = nodeTagColors(node);
  const tinted = tagColors.length > 0;
  const haloFill = tagColorFill(tagColors, HALO_OPACITY);
  const dotFill = tagColorFill(tagColors);
  const strokeColor = tagColors[0] ?? null;

  const glyph = KIND_GLYPH[mode.kind];
  const collapsible =
    collapsibleProp ?? (hasChildren || mode.kind === "query");
  const showHalo = collapsible && mode.collapsed;
  const showCount = showHalo && mode.childCount > 0;
  const isQuery = mode.kind === "query";
  const isSupertag = mode.kind === "tag";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bullet-container group/bullet relative flex h-6 w-6 shrink-0 items-center justify-center",
        "rounded-sm hover:bg-foreground/5 transition-colors duration-100",
        "cursor-pointer",
        mode.isSys && "opacity-50",
      )}
      tabIndex={-1}
      data-bullet-kind={mode.kind}
      data-bullet-ref={mode.isRef ? "true" : undefined}
      data-bullet-sys={mode.isSys ? "true" : undefined}
      title={
        collapsible
          ? "Click to toggle, Cmd+click to focus"
          : "Cmd+click to focus"
      }
      aria-label={
        collapsible
          ? mode.collapsed
            ? hasChildren
              ? `Expand (${mode.childCount} children)`
              : "Expand results"
            : "Collapse"
          : undefined
      }
    >
      {showHalo && (
        <span
          className="absolute rounded-full bg-foreground/8"
          style={{
            inset: "3px",
            background: haloFill ?? undefined,
          }}
          data-bullet-halo
        />
      )}

      {isSupertag ? (
        <span
          className={cn(
            "relative z-[1] block select-none text-[11px] font-bold leading-none",
            !tinted && "text-foreground/45",
            !tinted && hasChildren && "text-foreground/55",
            hasChildren &&
              !mode.collapsed &&
              !tinted &&
              "group-hover/bullet:text-foreground/70",
          )}
          style={strokeColor ? { color: strokeColor } : undefined}
          aria-hidden
        >
          #
        </span>
      ) : isQuery ? (
        <MagnifyingGlass
          size={14}
          weight="bold"
          className={cn("relative z-[1]", !tinted && "text-foreground/45")}
          style={strokeColor ? { color: strokeColor } : undefined}
          data-bullet-query
        />
      ) : mode.isRef ? (
        <span
          className={cn(
            "relative z-[1] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-dashed",
            !tinted && "border-foreground/20",
          )}
          style={
            strokeColor
              ? { borderColor: tagColorAlpha(strokeColor, REF_RING_OPACITY) }
              : undefined
          }
          data-bullet-ref-ring
        >
          <span
            className={cn(
              "block rounded-full",
              hasChildren ? "h-[5px] w-[5px]" : "h-[4px] w-[4px]",
              !tinted && "bg-foreground/40",
              !tinted && hasChildren && "bg-foreground/55",
            )}
            style={dotFill ? { background: dotFill } : undefined}
            data-bullet-dot
          />
        </span>
      ) : glyph ? (
        <span
          className={cn(
            "relative z-[1] select-none text-[11px] font-bold leading-none",
            "text-foreground/45",
          )}
          aria-hidden
        >
          {glyph}
        </span>
      ) : (
        <span
          className={cn(
            "relative z-[1] block rounded-full transition-all duration-100",
            hasChildren ? "h-[5px] w-[5px]" : "h-[4px] w-[4px]",
            !tinted && "bg-foreground/40",
            !tinted && hasChildren && "bg-foreground/50",
            hasChildren &&
              !mode.collapsed &&
              !tinted &&
              "group-hover/bullet:bg-foreground/60",
          )}
          style={dotFill ? { background: dotFill } : undefined}
          data-bullet-dot
        />
      )}

      {showCount && (
        <span
          className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/10 px-0.5 text-[9px] font-medium text-foreground/50"
          data-bullet-count
        >
          {mode.childCount}
        </span>
      )}
    </button>
  );
}
