import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { LensPerspective } from "@/lib/graph-lens";

interface PerspectivePickerProps {
  perspectives: LensPerspective[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Floating popover list — same anatomy as PreferencesPopover
 * (DESIGN-RESKIN §0 pattern economy: border/popover/shadow/11–12px type).
 */
export function PerspectivePicker({ perspectives, activeId, onSelect }: PerspectivePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = perspectives.find((p) => p.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-6 max-w-xs items-center gap-1 rounded-md px-1.5 text-[13px] text-foreground/70 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/85"
        aria-label="Perspective"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={perspectives.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{active?.label ?? "perspective"}</span>
        <CaretDown size={12} className="shrink-0 text-foreground/40" />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Graph perspectives"
          className="absolute left-0 top-full z-40 mt-1 min-w-[200px] max-w-xs rounded-lg border border-foreground/10 bg-popover p-1 shadow-xl"
        >
          <h2 className="px-1.5 pb-1 pt-0.5 text-[12px] uppercase tracking-wide text-foreground/30">
            Perspectives
          </h2>
          {perspectives.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === activeId}
              className={cn(
                "flex w-full items-center rounded-md px-1.5 py-1 text-left text-[13px] text-foreground/70 transition-colors duration-75 hover:bg-foreground/5 hover:text-foreground/85",
                p.id === activeId && "bg-foreground/[0.04] text-foreground/85",
              )}
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
            >
              <span className="truncate">{p.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
