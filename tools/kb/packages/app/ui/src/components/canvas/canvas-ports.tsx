import type { CanvasSide } from "@kb/canvas";
import { cn } from "@/lib/cn";

/** Shared, unclipped connection targets for every canvas card. */
export function CanvasPorts({
  onPortDown,
}: {
  onPortDown: (side: CanvasSide, event: React.PointerEvent) => void;
}) {
  return (["left", "right", "top", "bottom"] as const).map((side) => (
    <button
      key={side}
      type="button"
      data-port={side}
      aria-label={`Connect ${side}`}
      className={cn(
        "absolute z-20 flex h-6 w-6 items-center justify-center rounded-full text-foreground/35 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary hover:text-primary",
        side === "left" && "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2",
        side === "right" && "top-1/2 right-0 translate-x-1/2 -translate-y-1/2",
        side === "top" && "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
        side === "bottom" && "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        onPortDown(side, event);
      }}
    >
      <span className="h-2.5 w-2.5 rounded-full border-2 border-current bg-background shadow-sm" />
    </button>
  ));
}
