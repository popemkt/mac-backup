import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Terminal } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import {
  buildPaletteIndex,
  searchPalette,
  type PaletteHit,
  type PaletteIndex,
} from "@/lib/palette-index";
import { runPaletteCommand } from "@/lib/run-command";
import { schemaZoomKind } from "@/lib/schema-zoom";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

const ROW_LIMIT = 20;

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ⌘K "Search and open" — single overlay, fuzzy over all nodes + commands.
 * nxus chrome: backdrop-blur, single list, ↑↓/Enter (DESIGN-REFINE §2 W3).
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const rev = useOutlineStore((s) => s.rev);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const setView = useUiStore((s) => s.setView);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const indexCache = useRef<PaletteIndex | null>(null);

  // Index once per graph rev — not per keystroke.
  const index = useMemo(() => {
    if (indexCache.current?.rev === rev) return indexCache.current;
    const next = buildPaletteIndex(wireNodes, rev);
    indexCache.current = next;
    return next;
  }, [wireNodes, rev]);

  const hits = useMemo(
    () => searchPalette(index, query, ROW_LIMIT),
    [index, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const selectHit = useCallback(
    async (hit: PaletteHit) => {
      onClose();
      if (hit.kind === "command") {
        await runPaletteCommand(hit.id);
        return;
      }
      setView("outline");
      const node = useOutlineStore.getState().nodes.get(hit.id);
      if (schemaZoomKind(node) || hit.id.startsWith("sys.")) {
        zoomTo(hit.id);
        return;
      }
      jumpToNode(hit.id);
    },
    [onClose, setView, zoomTo, jumpToNode],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const hit = hits[active];
        if (hit) void selectHit(hit);
      }
    },
    [hits, active, onClose, selectHit],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search and open"
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-900/25 backdrop-blur-[2px]"
        aria-label="Dismiss palette"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-lg overflow-hidden rounded-xl",
          "border border-stone-200/80 bg-white/85 shadow-2xl backdrop-blur-xl",
        )}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-stone-200/70 px-3 py-2.5">
          <MagnifyingGlass size={16} className="shrink-0 text-stone-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search and open…"
            className="w-full bg-transparent text-[14px] text-stone-800 outline-none placeholder:text-stone-400"
            aria-autocomplete="list"
            aria-controls="kb-palette-list"
            aria-activedescendant={
              hits[active] ? `kb-palette-${hits[active]!.id}` : undefined
            }
          />
          <kbd className="hidden rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400 sm:inline">
            esc
          </kbd>
        </div>
        <ul
          id="kb-palette-list"
          role="listbox"
          className="max-h-[min(20*2rem,50vh)] overflow-auto py-1"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-3 text-[13px] text-stone-400">No matches</li>
          ) : (
            hits.map((hit, i) => (
              <li key={hit.id} role="option" aria-selected={i === active}>
                <button
                  id={`kb-palette-${hit.id}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                    i === active ? "bg-teal-50" : "hover:bg-stone-50",
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void selectHit(hit)}
                >
                  {hit.kind === "command" ? (
                    <Terminal
                      size={14}
                      className="shrink-0 text-[var(--kb-accent)]"
                    />
                  ) : (
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-stone-800">
                    {hit.text || "(empty)"}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-stone-400">
                    {hit.kind === "command" ? "cmd" : hit.id}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/** Header trigger that opens the palette (replaces inline SearchBox). */
export function PaletteTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full max-w-md items-center gap-2 rounded-md border border-stone-300/80 bg-white/70 px-2.5 py-1.5 text-left shadow-sm backdrop-blur hover:bg-white"
      aria-label="Open search palette"
    >
      <MagnifyingGlass size={14} className="shrink-0 text-stone-400" />
      <span className="flex-1 text-[13px] text-stone-400">Search and open…</span>
      <kbd className="rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400">
        ⌘K
      </kbd>
    </button>
  );
}
