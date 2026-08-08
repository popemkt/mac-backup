import { useCallback } from "react";
import { cn } from "@/lib/cn";
import type { ViewMode } from "@/lib/view-config";
import { mutations } from "@/actions/mutations";

interface ViewToolbarProps {
  frameId: string;
  mode: ViewMode;
  className?: string;
}

export function ViewToolbar({
  frameId,
  mode,
  className,
}: ViewToolbarProps) {
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
        "view-toolbar inline-flex items-center rounded-md bg-foreground/[0.04] p-0.5 border border-foreground/[0.06] select-none",
        className,
      )}
      data-view-toolbar="true"
      data-frame-id={frameId}
      data-active-mode={mode}
    >
      <button
        type="button"
        className={cn(
          "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
          mode === "list"
            ? "bg-background text-foreground shadow-xs font-semibold"
            : "text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80",
        )}
        data-mode-button="list"
        onClick={(e) => handleSelect("list", e)}
      >
        <span>≡</span>
        <span>List</span>
      </button>
      <button
        type="button"
        className={cn(
          "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
          mode === "table"
            ? "bg-background text-foreground shadow-xs font-semibold"
            : "text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80",
        )}
        data-mode-button="table"
        onClick={(e) => handleSelect("table", e)}
      >
        <span>⊞</span>
        <span>Table</span>
      </button>
    </div>
  );
}
