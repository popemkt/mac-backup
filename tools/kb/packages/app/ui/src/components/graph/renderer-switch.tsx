import { GRAPH_RENDERERS } from "./graph-renderers";
import { cn } from "@/lib/cn";
import type { LensRenderer } from "@/lib/graph-lens";

interface RendererSwitchProps {
  value: LensRenderer;
  onChange: (renderer: LensRenderer) => void;
  className?: string;
}

/** Pill group matching ViewToolbar anatomy (DESIGN-RESKIN §0). */
export function RendererSwitch({ value, onChange, className }: RendererSwitchProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-foreground/[0.06] bg-foreground/[0.04] p-0.5 select-none",
        className,
      )}
      data-renderer-switch="true"
      data-active-renderer={value}
    >
      {Object.keys(GRAPH_RENDERERS).map((r) => (
        <button
          key={r}
          type="button"
          data-renderer-button={r}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
            value === r
              ? "bg-background font-semibold text-foreground shadow-xs"
              : "text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80",
          )}
          onClick={() => {
            if (r !== value) onChange(r);
          }}
        >
          {GRAPH_RENDERERS[r]?.label ?? r}
        </button>
      ))}
    </div>
  );
}
