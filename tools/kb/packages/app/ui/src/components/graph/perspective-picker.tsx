import { mutations } from "@/actions/mutations";
import { useEffect, useRef, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
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
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
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
        <CaretDownIcon size={12} className="shrink-0 text-foreground/40" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Graph perspectives"
          className="absolute left-0 top-full z-40 mt-1 min-w-[200px] max-w-xs rounded-lg border border-foreground/10 bg-popover p-1 shadow-xl"
        >
          <h2 className="px-1.5 pb-1 pt-0.5 text-[12px] uppercase tracking-wide text-foreground/30">
            Perspectives
          </h2>
          <div role="listbox" aria-label="Saved perspectives" className="max-h-64 overflow-y-auto">
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
          {active ? (
            <form
              className="mt-1 space-y-2 border-t border-foreground/10 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  if (!name.trim() || saving) return;
                  setSaving(true);
                  setSaveError(false);
                  try {
                    const id = await mutations.saveGraphPerspective(active, name);
                    if (id !== null) {
                      onSelect(id);
                      setName("");
                      setOpen(false);
                    } else setSaveError(true);
                  } catch {
                    setSaveError(true);
                  } finally {
                    setSaving(false);
                  }
                })();
              }}
            >
              <p className="text-[11px] text-foreground/45">
                Save these mappings as a perspective node.
              </p>
              <input
                aria-label="Perspective name"
                placeholder="Name this perspective…"
                value={name}
                className="w-full rounded border border-foreground/10 bg-transparent px-2 py-1 text-xs"
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="submit"
                disabled={!name.trim() || saving}
                className="rounded bg-foreground/[0.07] px-2 py-1 text-xs disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save as new perspective"}
              </button>
              {saveError ? (
                <p role="alert" className="text-xs text-destructive">
                  Could not save. Your current perspective is still available.
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
