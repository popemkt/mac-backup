import { MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { BulletKind, BulletKindOverride } from "@/lib/bullet-mode";
import { resolveBulletMode, typeRefsOf } from "@/lib/bullet-mode";
import type { OutlineNode } from "@/lib/types";

interface BulletProps {
  node: OutlineNode;
  /** Reference-row state (query result / embedded ref) — dashed ring. */
  isRef?: boolean;
  /** W6 stubs: force media/canvas glyph before those tags exist. */
  kindOverride?: BulletKindOverride | null;
  /** Primary tag color for dot / halo (DESIGN-RESKIN §1.8). */
  tagColor?: string | null;
  onClick: (e: React.MouseEvent) => void;
}

const KIND_GLYPH: Partial<Record<BulletKind, string>> = {
  tag: "#",
  field: "\u2317",
  command: "\u2699",
  media: "\u25A3",
  canvas: "\u25C7",
};

export function Bullet({
  node,
  isRef = false,
  kindOverride = null,
  tagColor = null,
  onClick,
}: BulletProps) {
  const hasChildren = node.children.length > 0;
  const mode = resolveBulletMode({
    hasChildren,
    typeRefs: typeRefsOf(node),
    tagNames: node.tags.map((t) => t.name),
    isSys: node.id.startsWith("sys."),
    text: node.text,
    kindOverride,
    collapsed: node.collapsed,
    childCount: node.children.length,
    isRef,
  });

  const glyph = KIND_GLYPH[mode.kind];
  const collapsible = hasChildren || mode.kind === "query";
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
            backgroundColor: tagColor ? `${tagColor}20` : undefined,
          }}
          data-bullet-halo
        />
      )}

      {isSupertag ? (
        <span
          className={cn(
            "relative z-[1] block select-none text-[11px] font-bold leading-none",
            !tagColor && "text-foreground/45",
            !tagColor && hasChildren && "text-foreground/55",
            hasChildren &&
              !mode.collapsed &&
              !tagColor &&
              "group-hover/bullet:text-foreground/70",
          )}
          style={tagColor ? { color: tagColor } : undefined}
          aria-hidden
        >
          #
        </span>
      ) : isQuery ? (
        <MagnifyingGlass
          size={14}
          weight="bold"
          className={cn("relative z-[1]", !tagColor && "text-foreground/45")}
          style={tagColor ? { color: tagColor } : undefined}
          data-bullet-query
        />
      ) : mode.isRef ? (
        <span
          className={cn(
            "relative z-[1] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-dashed",
            !tagColor && "border-foreground/20",
          )}
          style={tagColor ? { borderColor: `${tagColor}40` } : undefined}
          data-bullet-ref-ring
        >
          <span
            className={cn(
              "block rounded-full",
              hasChildren ? "h-[5px] w-[5px]" : "h-[4px] w-[4px]",
              !tagColor && "bg-foreground/40",
              !tagColor && hasChildren && "bg-foreground/55",
            )}
            style={tagColor ? { backgroundColor: tagColor } : undefined}
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
            !tagColor && "bg-foreground/40",
            !tagColor && hasChildren && "bg-foreground/50",
            hasChildren &&
              !mode.collapsed &&
              !tagColor &&
              "group-hover/bullet:bg-foreground/60",
          )}
          style={tagColor ? { backgroundColor: tagColor } : undefined}
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
