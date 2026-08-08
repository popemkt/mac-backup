import { useCallback } from "react";
import { GearSix } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { ViewMode } from "@/lib/view-config";
import { mutations } from "@/actions/mutations";
import { useUiStore } from "@/stores/ui.store";
import { ViewFilterPopover } from "./view-filter-popover";

interface ViewToolbarProps {
  frameId: string;
  mode: ViewMode;
  className?: string;
}

const MODES: Array<{ id: ViewMode; label: string; icon: string }> = [
  { id: "list", label: "List", icon: "≡" },
  { id: "table", label: "Table", icon: "⊞" },
  { id: "board", label: "Board", icon: "▥" },
  { id: "cards", label: "Cards", icon: "▦" },
];

export function ViewToolbar({
  frameId,
  mode,
  className,
}: ViewToolbarProps) {
  const filterOpen = useUiStore((s) => s.filterPopoverFrameId === frameId);
  const setFilterFrame = useUiStore((s) => s.setFilterPopoverFrameId);

  const handleSelect = useCallback(
    (newMode: ViewMode, e: React.MouseEvent) => {
      e.stopPropagation();
      if (newMode !== mode) {
        void mutations.setViewMode(frameId, newMode);
      }
    },
    [frameId, mode],
  );

  return (
    <div
      className={cn(
        "view-toolbar relative inline-flex items-center gap-0.5 rounded-md bg-foreground/[0.04] p-0.5 border border-foreground/[0.06] select-none",
        className,
      )}
      data-view-toolbar="true"
      data-frame-id={frameId}
      data-active-mode={mode}
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={cn(
            "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
            mode === m.id
              ? "bg-background text-foreground shadow-xs font-semibold"
              : "text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80",
          )}
          data-mode-button={m.id}
          onClick={(e) => handleSelect(m.id, e)}
        >
          <span>{m.icon}</span>
          <span>{m.label}</span>
        </button>
      ))}
      <button
        type="button"
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/70",
          filterOpen && "bg-background text-foreground shadow-xs",
        )}
        data-filter-button="true"
        title="Filters"
        aria-label="Filters"
        onClick={(e) => {
          e.stopPropagation();
          setFilterFrame(filterOpen ? null : frameId);
        }}
      >
        <GearSix size={12} weight={filterOpen ? "fill" : "regular"} />
      </button>
      <ViewFilterPopover frameId={frameId} />
    </div>
  );
}
