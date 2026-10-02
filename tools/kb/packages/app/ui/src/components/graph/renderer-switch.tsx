import { cn } from "@/lib/cn";
import { type LensRenderer, localIdOf } from "@kb/views";
import { useRenderers } from "./use-renderers";

interface RendererSwitchProps {
  value: LensRenderer;
  onChange: (renderer: LensRenderer) => void;
  className?: string;
}

/**
 * Pill group matching ViewToolbar anatomy (DESIGN-RESKIN §0): one pill per
 * renderer view provided; choosing one names its view's option.
 */
export function RendererSwitch({ value, onChange, className }: RendererSwitchProps) {
  const renderers = useRenderers();
  const active = renderers.find(({ key }) => key.option === value)?.key;
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-foreground/[0.06] bg-foreground/[0.04] p-0.5 select-none",
        className,
      )}
      data-renderer-switch="true"
      data-active-renderer={active === undefined ? undefined : localIdOf(active)}
    >
      {renderers.map(({ key, picker }) => {
        const name = localIdOf(key);
        return (
          <button
            key={name}
            type="button"
            data-renderer-button={name}
            className={cn(
              "rounded-xs px-2 py-0.5 text-label font-medium transition-colors cursor-pointer",
              value === key.option
                ? "bg-background font-semibold text-foreground shadow-edge"
                : "text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80",
            )}
            onClick={() => {
              if (key.option !== value) onChange(key.option);
            }}
          >
            {picker.label}
          </button>
        );
      })}
    </div>
  );
}
