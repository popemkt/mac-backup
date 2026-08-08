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
  onClick: (e: React.MouseEvent) => void;
}

const KIND_GLYPH: Partial<Record<BulletKind, string>> = {
  tag: "#",
  field: "\u2317", // ⌗
  query: "\u2315", // ⌕
  command: "\u2699", // ⚙
  media: "\u25A3", // ▣
  canvas: "\u25C7", // ◇
};

export function Bullet({
  node,
  isRef = false,
  kindOverride = null,
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
  const showHalo = hasChildren && mode.collapsed;
  const showCount = showHalo && mode.childCount > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bullet-container group/bullet relative flex shrink-0 items-center justify-center",
        "rounded-sm",
        "hover:bg-[var(--kb-halo)] transition-colors duration-100",
        "cursor-pointer",
        mode.isSys && "opacity-50",
      )}
      style={{
        width: "var(--kb-row-h)",
        height: "var(--kb-row-h)",
      }}
      tabIndex={-1}
      data-bullet-kind={mode.kind}
      data-bullet-ref={mode.isRef ? "true" : undefined}
      data-bullet-sys={mode.isSys ? "true" : undefined}
      title={
        hasChildren
          ? "Click to toggle, Cmd+click to focus"
          : "Cmd+click to focus"
      }
      aria-label={
        hasChildren
          ? mode.collapsed
            ? `Expand (${mode.childCount} children)`
            : "Collapse"
          : undefined
      }
    >
      {showHalo && (
        <span
          className="absolute rounded-full bg-[var(--kb-halo)]"
          style={{ inset: "3px" }}
          data-bullet-halo
        />
      )}

      {mode.isRef && (
        <span
          className="absolute rounded-full border border-dashed border-[var(--kb-bullet)]"
          style={{ inset: "4px" }}
          data-bullet-ref-ring
        />
      )}

      {glyph ? (
        <span
          className={cn(
            "relative z-[1] select-none leading-none",
            "text-[var(--kb-bullet-strong)]",
            "text-[11px] font-medium",
          )}
          aria-hidden
        >
          {glyph}
        </span>
      ) : (
        <span
          className={cn(
            "relative z-[1] block rounded-full transition-all duration-100",
            "bg-[var(--kb-bullet)]",
            mode.kind === "parent" && "bg-[var(--kb-bullet-strong)]",
            mode.kind === "parent" &&
              !mode.collapsed &&
              "group-hover/bullet:opacity-90",
          )}
          style={{
            width: mode.kind === "parent" ? 5 : 4,
            height: mode.kind === "parent" ? 5 : 4,
          }}
          data-bullet-dot
        />
      )}

      {showCount && (
        <span
          className={cn(
            "absolute -right-1 -top-1 flex min-w-3.5 items-center justify-center",
            "rounded-full bg-[var(--kb-halo)] px-0.5",
            "kb-chip font-medium text-[var(--kb-muted)]",
          )}
          style={{ height: "14px" }}
          data-bullet-count
        >
          {mode.childCount}
        </span>
      )}
    </button>
  );
}
