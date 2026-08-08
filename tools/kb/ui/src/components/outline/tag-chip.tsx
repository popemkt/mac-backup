import { Hash, GearSix, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { TagBadge } from "@/lib/types";

export interface TagChipProps {
  tag: TagBadge;
  onClick?: (e: React.MouseEvent) => void;
  onRemove?: (e: React.MouseEvent) => void;
  onConfigure?: (e: React.MouseEvent) => void;
  className?: string;
}

/** DESIGN-RESKIN §1.2/1.8 — the one tag chip everywhere. */
export function TagChip({
  tag,
  onClick,
  onRemove,
  onConfigure,
  className,
}: TagChipProps) {
  return (
    <span
      className={cn(
        "group/tag inline-flex h-4 max-w-full items-center gap-0.5 rounded-sm px-1.5 py-0",
        "text-[11px] font-medium leading-4",
        "kb-chip select-none whitespace-nowrap",
        "cursor-pointer transition-opacity hover:opacity-70",
        className,
      )}
      style={{
        backgroundColor: `${tag.color}18`,
        color: tag.color,
      }}
      onClick={onClick}
      title={`Go to: ${tag.name}`}
    >
      <span className="relative h-[10px] w-[10px] shrink-0">
        <Hash
          size={10}
          weight="bold"
          className="opacity-60 transition-opacity group-hover/tag:opacity-0"
        />
        {onRemove && (
          <span
            className="absolute inset-0 flex cursor-pointer items-center justify-center opacity-0 transition-opacity group-hover/tag:opacity-60 hover:!opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(e);
            }}
            title={`Remove #${tag.name}`}
          >
            <X size={10} weight="bold" />
          </span>
        )}
      </span>
      <span className="truncate">{tag.name}</span>
      {onConfigure && (
        <span
          className="relative ml-0.5 flex h-[10px] w-[10px] shrink-0 cursor-pointer items-center justify-center opacity-0 transition-opacity group-hover/tag:opacity-40 hover:!opacity-80"
          onClick={(e) => {
            e.stopPropagation();
            onConfigure(e);
          }}
          title={`Configure #${tag.name}`}
        >
          <GearSix size={10} weight="bold" />
        </span>
      )}
    </span>
  );
}

export function TagChipGroup({
  tags,
  onTagClick,
  onTagRemove,
  onTagConfigure,
}: {
  tags: TagBadge[];
  onTagClick?: (tag: TagBadge, e: React.MouseEvent) => void;
  onTagRemove?: (tag: TagBadge, e: React.MouseEvent) => void;
  onTagConfigure?: (tag: TagBadge, e: React.MouseEvent) => void;
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
          onConfigure={
            onTagConfigure ? (e) => onTagConfigure(tag, e) : undefined
          }
        />
      ))}
    </div>
  );
}
