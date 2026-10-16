/**
 * The canvas's shortcuts, listed: every row of the one shortcut table
 * (`CANVAS_SHORTCUTS`) that has a chord, by section, with every chord that
 * presses it. Opened with `?`; Escape, a press outside it or its button
 * closes it.
 */
import { useEffect, useRef } from "react";
import { isOutside } from "@kb/ui-sdk";
import {
  CANVAS_SHORTCUTS,
  chordHint,
  type CanvasShortcut,
  type CanvasShortcutSection,
} from "./canvas-keymap";

/** The sections, in the order the sheet lists them. */
const SECTIONS: readonly CanvasShortcutSection[] = [
  "Tools",
  "Edit",
  "Arrange",
  "View",
  "Transform",
  "Present",
];

/** The rows a section lists: named ones that a chord presses. */
const rowsOf = (section: CanvasShortcutSection): readonly CanvasShortcut[] =>
  CANVAS_SHORTCUTS.filter((s) => s.section === section && s.label !== "" && s.chords.length > 0);

/** Every chord of a row in words, each one once. */
const chordsOf = (row: CanvasShortcut): string[] =>
  row.chords.length > 4 ? [row.hint] : [...new Set(row.chords.map(chordHint))];

export function CanvasShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const away = (e: PointerEvent) => {
      if (isOutside(sheet.current, e.target)) onClose();
    };
    // Ahead of the canvas's own keys: Escape closes the sheet and does nothing else.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", away, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={sheet}
      role="dialog"
      aria-label="Canvas shortcuts"
      data-testid="canvas-shortcuts"
      className="kb-surface-enter absolute top-1/2 left-1/2 z-40 max-h-[80%] w-[min(40rem,90%)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-foreground/10 bg-popover p-4 text-ui text-popover-foreground shadow-overlay"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-meta font-medium text-foreground/70">Canvas shortcuts</span>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-label text-foreground/55 hover:bg-foreground/5"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="columns-2 gap-6">
        {SECTIONS.map((section) => (
          <section key={section} className="mb-3 break-inside-avoid">
            <h3 className="mb-1 text-label font-medium text-foreground/45">{section}</h3>
            {rowsOf(section).map((row) => (
              <div
                key={`${section}:${row.label}`}
                className="flex items-baseline justify-between gap-3 py-0.5"
              >
                <span className="truncate text-foreground/75">{row.label}</span>
                <kbd className="shrink-0 font-mono text-label text-foreground/40">
                  {chordsOf(row).join(" ")}
                </kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
