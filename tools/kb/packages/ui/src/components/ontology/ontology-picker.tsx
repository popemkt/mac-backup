import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { OntologyNavItem } from "@/lib/ontology-scope";

interface OntologyPickerProps {
  ontologies: OntologyNavItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Rendered as the last row when a scope is active. */
  onClear?: () => void;
  /** Label shown when nothing is selected. */
  placeholder?: string;
}

/**
 * Scope selector — same anatomy as PerspectivePicker (DESIGN-RESKIN §0 pattern
 * economy: border/popover/shadow/11–13px type). An ontology decides WHICH
 * nodes; a perspective decides how they look, so both pickers coexist.
 */
export function OntologyPicker({
  ontologies,
  activeId,
  onSelect,
  onClear,
  placeholder = "ontology",
}: OntologyPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = ontologies.find((o) => o.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
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
        aria-label="Ontology"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={ontologies.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden className="shrink-0 text-foreground/40">
          ⬡
        </span>
        <span className="truncate">{active?.label ?? placeholder}</span>
        <CaretDown size={12} className="shrink-0 text-foreground/40" />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Ontologies"
          className="absolute left-0 top-full z-40 mt-1 min-w-[200px] max-w-xs rounded-lg border border-foreground/10 bg-popover p-1 shadow-xl"
        >
          <h2 className="px-1.5 pb-1 pt-0.5 text-[12px] uppercase tracking-wide text-foreground/30">
            Ontologies
          </h2>
          {ontologies.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === activeId}
              className={cn(
                "flex w-full items-center rounded-md px-1.5 py-1 text-left text-[13px] text-foreground/70 transition-colors duration-75 hover:bg-foreground/5 hover:text-foreground/85",
                o.id === activeId && "bg-foreground/[0.04] text-foreground/85",
              )}
              onClick={() => {
                onSelect(o.id);
                setOpen(false);
              }}
            >
              <span className="truncate">{o.label}</span>
            </button>
          ))}
          {onClear && activeId ? (
            <button
              type="button"
              className="mt-1 flex w-full items-center rounded-md border-t border-foreground/[0.06] px-1.5 pt-1.5 text-left text-[12px] text-foreground/40 transition-colors duration-75 hover:text-foreground/70"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Leave ontology
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
