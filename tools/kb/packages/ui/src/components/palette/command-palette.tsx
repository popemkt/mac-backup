import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, TerminalIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { buildPaletteIndex, searchPalette, type PaletteHit } from "@/lib/palette-index";
import { asInstance } from "@/lib/dom";
import { runPaletteCommand } from "@/lib/run-command";
import { schemaZoomKind } from "@/lib/schema-zoom";
import { isSysPrefixed } from "@/lib/types";
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
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  /*
   * Index once per graph load — not per keystroke.
   *
   * There used to be a ref cache keyed on rev in front of this memo, which made
   * search permanently empty on a freshly loaded store: this component mounts
   * before hydration, caches an empty index at rev 0, and a store that has not
   * been mutated since it opened is still at rev 0 — so the guard short
   * circuited forever and ⌘K matched nothing. useMemo already rebuilds exactly
   * when its inputs change, so the cache was only able to be wrong.
   */
  const index = useMemo(() => buildPaletteIndex(wireNodes, rev), [wireNodes, rev]);

  const hits = useMemo(() => searchPalette(index, query, ROW_LIMIT), [index, query]);

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActive(0);
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(t);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open || !hits[active]) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-palette-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [active, hits, open]);

  const selectHit = useCallback(
    async (hit: PaletteHit) => {
      onClose();
      if (hit.kind === "command") {
        await runPaletteCommand(hit.id);
        return;
      }
      const node = useOutlineStore.getState().nodes.get(hit.id);
      if (schemaZoomKind(node) || isSysPrefixed(hit.id)) {
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
        return;
      }
      if (e.key === "Tab") {
        const focusable = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            "input:not([disabled]), button:not([disabled]), [href]",
          ),
        );
        if (focusable.length === 0) return;
        const current = asInstance(document.activeElement, HTMLElement);
        const currentIndex = current === undefined ? -1 : focusable.indexOf(current);
        const next = e.shiftKey
          ? currentIndex <= 0
            ? focusable.length - 1
            : currentIndex - 1
          : currentIndex === focusable.length - 1
            ? 0
            : currentIndex + 1;
        e.preventDefault();
        focusable[next]?.focus();
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
          <MagnifyingGlassIcon size={16} className="shrink-0 text-foreground/25" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search and open…"
            className="kb-text w-full bg-transparent text-foreground/85 outline-none placeholder:text-foreground/25"
            aria-autocomplete="list"
            aria-controls="kb-palette-list"
            aria-activedescendant={hits[active] ? `kb-palette-${hits[active].id}` : undefined}
          />
          <kbd className="hidden rounded border border-foreground/10 px-1.5 py-0.5 text-[10px] text-foreground/40 sm:inline">
            esc
          </kbd>
        </div>
        <ul
          id="kb-palette-list"
          role="listbox"
          ref={listRef}
          className="max-h-[min(20*2rem,50vh)] overflow-auto py-1"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-3 text-[13px] text-foreground/40">No matches</li>
          ) : (
            hits.map((hit, i) => (
              <li key={hit.id} role="option" aria-selected={i === active}>
                <button
                  id={`kb-palette-${hit.id}`}
                  data-palette-row={hit.id}
                  data-palette-active={i === active ? "true" : undefined}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                    i === active ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]",
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void selectHit(hit)}
                >
                  {hit.kind === "command" ? (
                    <TerminalIcon size={14} className="shrink-0 text-primary" />
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
      <MagnifyingGlassIcon size={14} className="shrink-0 text-foreground/25" />
      <span className="flex-1 text-[13px] text-foreground/25">Search and open…</span>
      <kbd className="rounded border border-foreground/10 px-1.5 py-0.5 text-[10px] text-foreground/40">
        ⌘K
      </kbd>
    </button>
  );
}
