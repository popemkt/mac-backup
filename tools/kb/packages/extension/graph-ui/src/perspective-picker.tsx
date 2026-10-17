import { saveGraphPerspective } from "./lens-writes";
import { useRef, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { cn, useDismiss } from "@kb/ui-sdk";
import type { LensPerspective, RendererKey } from "@kb/graph";

interface PerspectivePickerProps {
  perspectives: LensPerspective[];
  activeId: string | null;
  /** The active perspective's renderer: what a copy of it is saved as; null while none is provided. */
  renderer: RendererKey<unknown> | null;
  onSelect: (id: string) => void;
}

/**
 * Floating popover list — same anatomy as PreferencesPopover
 * (DESIGN-RESKIN §0 pattern economy: border/popover/shadow/11–12px type).
 */
export function PerspectivePicker({
  perspectives,
  activeId,
  renderer,
  onSelect,
}: PerspectivePickerProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = perspectives.find((p) => p.id === activeId) ?? null;

  useDismiss(open, [rootRef], () => setOpen(false));

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-6 max-w-xs items-center gap-1 rounded-md px-1.5 text-ui text-foreground/70 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/85"
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
          className="absolute left-0 top-full z-40 mt-1 min-w-[200px] max-w-xs rounded-lg border border-foreground/10 bg-popover p-1 shadow-overlay"
        >
          <h2 className="px-1.5 pb-1 pt-0.5 text-meta uppercase tracking-wide text-foreground/30">
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
                  "flex w-full items-center rounded-md px-1.5 py-1 text-left text-ui text-foreground/70 transition-colors duration-75 hover:bg-foreground/5 hover:text-foreground/85",
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
          {active && renderer ? (
            <form
              className="mt-1 space-y-2 border-t border-foreground/10 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  if (!name.trim() || saving) return;
                  setSaving(true);
                  setSaveError(false);
                  try {
                    const saved = await saveGraphPerspective(renderer, active, name);
                    if ("id" in saved) {
                      onSelect(saved.id);
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
              <p className="text-label text-foreground/45">
                Save these mappings as a perspective node.
              </p>
              <input
                aria-label="Perspective name"
                placeholder="Name this perspective…"
                value={name}
                className="w-full rounded-xs border border-foreground/10 bg-transparent px-2 py-1 text-meta leading-4"
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="submit"
                disabled={!name.trim() || saving}
                className="rounded-xs bg-foreground/[0.07] px-2 py-1 text-meta leading-4 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save as new perspective"}
              </button>
              {saveError ? (
                <p role="alert" className="text-meta leading-4 text-destructive">
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
