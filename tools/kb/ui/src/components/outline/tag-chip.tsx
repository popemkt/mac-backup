import { Hash, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { TagBadge } from "@/lib/types";

export interface TagChipProps {
  tag: TagBadge;
  onClick?: (e: React.MouseEvent) => void;
  onRemove?: (e: React.MouseEvent) => void;
  className?: string;
}


/** DESIGN-RESKIN §1.2/1.8 — the one tag chip everywhere. Tokenized smaller (—tag-size). */
export function TagChip({ tag, onClick, onRemove, className }: TagChipProps) {
  const canNavigate = Boolean(onClick);
  return (
    <span
      className={cn(
        "group/tag inline-flex h-[14px] max-w-full items-center gap-0.5 rounded-sm px-1 py-0",
        "kb-tag select-none whitespace-nowrap",
        "transition-opacity hover:opacity-70",
        className,
      )}
      style={{
        backgroundColor: `${tag.color}18`,
        color: tag.color,
      }}
    >
      {canNavigate ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          onClick={onClick}
          title={`Go to: ${tag.name}`}
          aria-label={`Go to tag ${tag.name}`}
        >
          <Hash size={9} weight="bold" className="shrink-0 opacity-60" />
          <span className="truncate">{tag.name}</span>
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-0.5">
          <Hash size={9} weight="bold" className="shrink-0 opacity-60" />
          <span className="truncate">{tag.name}</span>
        </span>
      )}
      {onRemove ? (
        <button
          type="button"
          className="ml-0.5 hidden h-[12px] w-[12px] shrink-0 items-center justify-center rounded-sm opacity-60 group-hover/tag:flex hover:!opacity-100 focus:flex focus-visible:ring-2 focus-visible:ring-primary/60 group-focus-within/tag:flex"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(e);
          }}
          title={`Remove #${tag.name}`}
          aria-label={`Remove tag ${tag.name}`}
        >
          <X size={10} weight="bold" />
        </button>
      ) : null}
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
      className="flex max-w-[min(100%,16rem)] shrink-0 flex-wrap items-center gap-0.5 self-start"
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
