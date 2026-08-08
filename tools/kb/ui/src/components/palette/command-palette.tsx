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
      const node = useOutlineStore.getState().nodes.get(hit.id);
      if (schemaZoomKind(node) || hit.id.startsWith("sys.")) {
        zoomTo(hit.id);
        return;
      }
      jumpToNode(hit.id);
    },
    [onClose, zoomTo, jumpToNode],
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
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        aria-label="Dismiss palette"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-[520px] overflow-hidden rounded-xl",
          "border border-foreground/10 bg-popover shadow-2xl",
        )}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-foreground/[0.06] px-3 py-2.5">
          <MagnifyingGlass size={16} className="shrink-0 text-foreground/25" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search and open…"
            className="w-full bg-transparent text-[14.5px] text-foreground/85 outline-none placeholder:text-foreground/25"
            aria-autocomplete="list"
            aria-controls="kb-palette-list"
            aria-activedescendant={
              hits[active] ? `kb-palette-${hits[active]!.id}` : undefined
            }
          />
          <kbd className="hidden rounded border border-foreground/10 px-1.5 py-0.5 text-[10px] text-foreground/40 sm:inline">
            esc
          </kbd>
        </div>
        <ul
          id="kb-palette-list"
          role="listbox"
          className="max-h-[min(20*2rem,50vh)] overflow-auto py-1"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-3 text-[13px] text-foreground/40">
              No matches
            </li>
          ) : (
            hits.map((hit, i) => (
              <li key={hit.id} role="option" aria-selected={i === active}>
                <button
                  id={`kb-palette-${hit.id}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                    i === active
                      ? "bg-foreground/[0.06]"
                      : "hover:bg-foreground/[0.03]",
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void selectHit(hit)}
                >
                  {hit.kind === "command" ? (
                    <Terminal size={14} className="shrink-0 text-primary" />
                  ) : (
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/25" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85">
                    {hit.text || "(empty)"}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-foreground/30">
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
      className="flex w-full max-w-xs items-center gap-2 rounded-md bg-foreground/[0.03] px-2.5 py-1 text-left transition-colors duration-100 hover:bg-foreground/[0.06]"
      aria-label="Open search palette"
    >
      <MagnifyingGlass size={14} className="shrink-0 text-foreground/25" />
      <span className="flex-1 text-[13px] text-foreground/25">
        Search and open…
      </span>
      <kbd className="rounded border border-foreground/10 px-1.5 py-0.5 text-[10px] text-foreground/40">
        ⌘S
      </kbd>
    </button>
  );
}
