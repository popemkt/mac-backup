import { useCallback, useState } from "react";
import { GearSixIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { type FrameViewKey, localIdOf } from "@kb/views";
import { mutations } from "@/actions/mutations";
import { useUiStore } from "@/stores/ui.store";
import { useFrameViews } from "./use-frame-views";

interface ViewToolbarProps {
  frameId: string;
  /** The view the frame's children are shown in now; null while none is provided. */
  view: FrameViewKey | null;
  className?: string;
  /**
   * Zoomed-header mode: collapse modes+filter behind a single gear until
   * expanded on demand (or when the filter popover is open for this frame).
   */
  tucked?: boolean;
}

/** One button per frame view provided, in its picker's order; the stored name is the key's local id. */
export function ViewToolbar({ frameId, view, className, tucked = false }: ViewToolbarProps) {
  const options = useFrameViews();
  const filterOpen = useUiStore((s) => s.filterPopoverFrameId === frameId);
  const setFilterFrame = useUiStore((s) => s.setFilterPopoverFrameId);
  const [expanded, setExpanded] = useState(false);
  const showChrome = !tucked || expanded || filterOpen;

  const handleSelect = useCallback(
    (next: FrameViewKey, e: React.MouseEvent) => {
      e.stopPropagation();
      if (next !== view) {
        void mutations.setFrameView(frameId, next);
      }
    },
    [frameId, view],
  );

  if (!showChrome) {
    return (
      <button
        type="button"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md border border-foreground/[0.06] bg-foreground/[0.04] text-foreground/40 hover:bg-foreground/[0.08] hover:text-foreground/70",
          className,
        )}
        data-view-toolbar-gear="true"
        data-frame-id={frameId}
        title="View options"
        aria-label="View options"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(true);
        }}
      >
        <GearSixIcon size={14} />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "view-toolbar relative inline-flex items-center gap-0.5 rounded-md bg-foreground/[0.04] p-0.5 border border-foreground/[0.06] select-none",
        className,
      )}
      data-view-toolbar="true"
      data-frame-id={frameId}
      data-active-mode={view === null ? undefined : localIdOf(view)}
      data-tucked={tucked ? "true" : undefined}
    >
      {options.map(({ key: option, picker }) => (
        <button
          key={option.id}
          type="button"
          className={cn(
            "flex items-center gap-1 rounded-xs px-2 py-0.5 text-label font-medium transition-colors cursor-pointer",
            view === option
              ? "bg-background text-foreground shadow-edge font-semibold"
              : "text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80",
          )}
          data-mode-button={localIdOf(option)}
          onClick={(e) => handleSelect(option, e)}
        >
          <span>{picker.glyph}</span>
          <span>{picker.label}</span>
        </button>
      ))}
      <button
        type="button"
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-xs text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/70",
          filterOpen && "bg-background text-foreground shadow-edge",
        )}
        data-filter-button="true"
        title="Filters"
        aria-label="Filters"
        onClick={(e) => {
          e.stopPropagation();
          setFilterFrame(filterOpen ? null : frameId);
        }}
      >
        <GearSixIcon size={12} weight={filterOpen ? "fill" : "regular"} />
      </button>
      {tucked ? (
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-xs text-foreground/30 hover:text-foreground/60"
          title="Collapse view options"
          aria-label="Collapse view options"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
            if (filterOpen) setFilterFrame(null);
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
