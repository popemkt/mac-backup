import { cn } from "@/lib/cn";
import type { LensRenderer } from "@/lib/graph-lens";
import { localIdOf } from "@/lib/plugins";
import { useRenderers } from "./use-renderers";

interface RendererSwitchProps {
  value: LensRenderer;
  onChange: (renderer: LensRenderer) => void;
  className?: string;
}

/**
 * Pill group matching ViewToolbar anatomy (DESIGN-RESKIN §0): one pill per
 * renderer view provided, named in `lens.renderer` by its local id.
 */
export function RendererSwitch({ value, onChange, className }: RendererSwitchProps) {
  const renderers = useRenderers();
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-foreground/[0.06] bg-foreground/[0.04] p-0.5 select-none",
        className,
      )}
      data-renderer-switch="true"
      data-active-renderer={value}
    >
      {renderers.map((key) => {
        const name = localIdOf(key);
        return (
          <button
            key={name}
            type="button"
            data-renderer-button={name}
            className={cn(
              "rounded-xs px-2 py-0.5 text-label font-medium transition-colors cursor-pointer",
              value === name
                ? "bg-background font-semibold text-foreground shadow-edge"
                : "text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80",
            )}
            onClick={() => {
              if (name !== value) onChange(name);
            }}
          >
            {key.renderer.label}
          </button>
        );
      })}
    </div>
  );
}
