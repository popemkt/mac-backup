/**
 * The shell's docks (`DockPoint`): one toggle per dock in the workspace
 * header, and the open one at the workspace's right edge. The shell names no
 * dock; a plugin contributes it, and unloading the plugin takes its toggle
 * and its window with it.
 */
import { useMemo } from "react";
import { DockPoint, useContributions, type Dock } from "@/lib/plugins";
import { cn } from "@/lib/cn";
import { useNarrowViewport } from "@/lib/viewport";
import { useUiStore } from "@/stores/ui.store";

const DOCK_WIDTH_PX = 380;

function useDocks(): readonly { readonly id: string; readonly dock: Dock }[] {
  const contributed = useContributions(DockPoint);
  return useMemo(
    () =>
      contributed
        .toSorted((a, b) => a.value.order - b.value.order)
        .map(({ id, value }) => ({ id, dock: value })),
    [contributed],
  );
}

/** The header's dock toggles, beside the palette trigger. */
export function DockToggles() {
  const docks = useDocks();
  const open = useUiStore((s) => s.openDock);
  const setOpen = useUiStore((s) => s.setOpenDock);
  return docks.map(({ id, dock: { label, icon: Glyph } }) => {
    const pressed = open === id;
    return (
      <button
        key={id}
        type="button"
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-100",
          pressed
            ? "bg-foreground/[0.07] text-foreground/75"
            : "text-foreground/40 hover:bg-foreground/5 hover:text-foreground/70",
        )}
        aria-label={pressed ? `Close ${label}` : `Open ${label}`}
        aria-pressed={pressed}
        title={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(pressed ? null : id)}
      >
        <Glyph size={15} weight={pressed ? "fill" : "regular"} />
      </button>
    );
  });
}

/**
 * The open dock, at the workspace's right edge. From 768px up it takes its
 * width in the row beside the page; below that it floats over the page, as
 * the sidebar does, so it never squeezes the page into a sideways scroll.
 */
export function DockHost() {
  const docks = useDocks();
  const open = useUiStore((s) => s.openDock);
  const setOpen = useUiStore((s) => s.setOpenDock);
  const narrow = useNarrowViewport();
  const shown = docks.find(({ id }) => id === open);
  if (shown === undefined) return null;
  const { Component, label } = shown.dock;
  return (
    <aside
      aria-label={label}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-l border-foreground/[0.06] bg-background",
        narrow && "fixed inset-y-0 right-0 z-40 shadow-overlay",
      )}
      style={{ width: narrow ? `min(${DOCK_WIDTH_PX}px, 100vw)` : DOCK_WIDTH_PX }}
    >
      <Component onClose={() => setOpen(null)} />
    </aside>
  );
}
