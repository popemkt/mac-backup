import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

/** Shared prefs / filter panel chrome (DESIGN-RESKIN §0). */
export const POPOVER_VALUE_CLASS =
  "min-w-0 flex-1 cursor-pointer appearance-none rounded-sm border-none bg-transparent text-[14.5px] leading-[1.6] text-foreground/70 outline-none hover:text-foreground/85";

export interface PopoverShellProps {
  title: string;
  children: ReactNode;
  panelRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
  "data-testid"?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function PopoverShell({
  title,
  children,
  panelRef,
  className,
  style,
  onClick,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: PopoverShellProps) {
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel ?? title}
      data-testid={testId}
      className={cn(
        "z-40 w-[320px] rounded-lg border border-foreground/10 bg-popover p-2 shadow-xl",
        className,
      )}
      style={style}
      onClick={onClick}
    >
      <h2 className="px-1.5 pb-1 pt-0.5 text-[12px] uppercase tracking-wide text-foreground/30">
        {title}
      </h2>
      {children}
    </div>
  );
}
