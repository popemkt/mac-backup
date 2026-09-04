import { HashIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { TagBadge } from "@/lib/types";

export interface TagChipProps {
  tag: TagBadge;
  onClick?: (e: React.MouseEvent) => void;
  onRemove?: (e: React.MouseEvent) => void;
  className?: string;
}

/**
 * DESIGN-RESKIN §1.2/1.8 — the one tag chip everywhere.
 * Tokenized via `.kb-tag` / `--tag-size` / `--tag-h`: the pill fills the text
 * line box (Tana parity) and its box metrics live with the token, not here —
 * a component that restates `h-[12px]` is a second source of truth for the
 * same thing. The mark scales in `em`, so it tracks --tag-size for free.
 * Remove × overlays the hash slot so hover never changes measured width
 * (i10 item 2; Tana/CodeFlow placement).
 */
export function TagChip({ tag, onClick, onRemove, className }: TagChipProps) {
  const canNavigate = Boolean(onClick);
  const mark = (
    <span
      className="relative inline-flex h-[1em] w-[1em] shrink-0 items-center justify-center"
      data-tag-mark="true"
    >
      <HashIcon
        size="1em"
        weight="bold"
        className={cn(
          "opacity-60 transition-opacity",
          onRemove && "group-hover/tag:opacity-0 group-focus-within/tag:opacity-0",
        )}
        aria-hidden
      />
      {onRemove ? (
        <button
          type="button"
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-sm",
            "opacity-0 transition-opacity",
            "group-hover/tag:opacity-60 group-focus-within/tag:opacity-60",
            "hover:!opacity-100 focus-visible:opacity-100",
            "focus-visible:ring-2 focus-visible:ring-primary/60 outline-none",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(e);
          }}
          title={`Remove #${tag.name}`}
          aria-label={`Remove tag ${tag.name}`}
          data-tag-remove="true"
        >
          <XIcon size="1em" weight="bold" />
        </button>
      ) : null}
    </span>
  );

  const label = <span className="truncate">{tag.name}</span>;

  return (
    <span
      className={cn(
        "group/tag inline-flex max-w-full items-center gap-1 rounded-sm px-1.5 py-0",
        "kb-tag select-none whitespace-nowrap",
        "transition-opacity hover:opacity-70",
        className,
      )}
      style={{
        backgroundColor: `${tag.color}18`,
        color: tag.color,
      }}
      data-tag-chip="true"
    >
      {canNavigate ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          onClick={onClick}
          title={`Go to: ${tag.name}`}
          aria-label={`Go to tag ${tag.name}`}
        >
          {mark}
          {label}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-0.5">
          {mark}
          {label}
        </span>
      )}
    </span>
  );
}

export function TagChipGroup({
  tags,
  onTagClick,
  onTagRemove,
}: {
  tags: TagBadge[];
  onTagClick?: (tag: TagBadge, e: React.MouseEvent) => void;
  onTagRemove?: (tag: TagBadge, e: React.MouseEvent) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div
      className="flex max-w-[min(100%,16rem)] flex-wrap items-center gap-1"
      data-tag-chip-group="true"
    >
      {tags.map((tag) => (
        <TagChip
          key={tag.id}
          tag={tag}
          onClick={onTagClick ? (e) => onTagClick(tag, e) : undefined}
          onRemove={onTagRemove ? (e) => onTagRemove(tag, e) : undefined}
        />
      ))}
    </div>
  );
}
