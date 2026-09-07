import { useRef } from "react";
import { ListIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export interface SidebarToggleProps {
  open: boolean;
  /**
   * Receives the button itself, so a caller whose collapsing region held focus
   * can hand focus back to it instead of dropping it on the document.
   */
  onToggle: (button: HTMLButtonElement | null) => void;
  className?: string;
}

/**
 * The one left-rail toggle: the shell header and every page header that has
 * one render this. It takes the flag and the gesture as props —
 * `useSidebarToggle` on the prefs store owns both.
 */
export function SidebarToggle({ open, onToggle, className }: SidebarToggleProps) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      type="button"
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70",
        className,
      )}
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={open}
      title={open ? "Collapse sidebar" : "Expand sidebar"}
      onClick={() => onToggle(ref.current)}
      ref={ref}
    >
      <ListIcon size={15} />
    </button>
  );
}
