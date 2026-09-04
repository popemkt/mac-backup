import { useEffect, useMemo, useRef, useState } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export interface RefCandidateItem {
  id: string;
  label: string;
  /** Rendered muted after the label (e.g. "already extends"). */
  note?: string;
  disabled?: boolean;
}

interface RefAddPopoverProps {
  /** Button label, e.g. "+ tag". */
  trigger: string;
  title: string;
  candidates: RefCandidateItem[];
  onPick: (id: string) => void;
  emptyHint?: string;
}

/**
 * Filterable "add a ref" popover for the ontology page's include / extends
 * rows. Deliberately small: the ontology page owns three ref lists and nothing
 * else needs a picker this shape yet.
 */
export function RefAddPopover({
  trigger,
  title,
  candidates,
  onPick,
  emptyHint = "Nothing to add",
}: RefAddPopoverProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? candidates.filter(
          (c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
        )
      : candidates;
    return list.slice(0, 40);
  }, [candidates, filter]);

  useEffect(() => {
    if (!open) return;
    setFilter("");
    setActive(0);
    // Focus after paint so the popover is mounted.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const commit = (item: RefCandidateItem | undefined) => {
    if (!item || item.disabled === true) return;
    onPick(item.id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-[18px] items-center gap-0.5 rounded-sm border border-dashed border-foreground/15 px-1.5 text-[11px] text-foreground/40 transition-colors duration-100 hover:border-foreground/30 hover:text-foreground/70"
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon size={9} weight="bold" />
        {trigger}
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-40 mt-1 w-[260px] rounded-lg border border-foreground/10 bg-popover p-1 shadow-xl"
          role="dialog"
          aria-label={title}
        >
          <input
            ref={inputRef}
            value={filter}
            placeholder={title}
            aria-label={title}
            className="mb-1 w-full rounded-md bg-foreground/[0.04] px-2 py-1 text-[12px] text-foreground/85 outline-none placeholder:text-foreground/30"
            onChange={(e) => {
              setFilter(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, hits.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commit(hits[active]);
              }
            }}
          />
          <div role="listbox" aria-label={title} className="max-h-56 overflow-auto">
            {hits.length === 0 ? (
              <p className="px-2 py-1.5 text-[12px] text-foreground/30">{emptyHint}</p>
            ) : (
              hits.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  disabled={c.disabled}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px]",
                    "transition-colors duration-75",
                    c.disabled === true
                      ? "cursor-not-allowed text-foreground/25"
                      : "text-foreground/75 hover:bg-foreground/5 hover:text-foreground/90",
                    i === active && c.disabled !== true && "bg-foreground/[0.05]",
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(c)}
                >
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.note ? (
                    <span className="shrink-0 text-[10px] text-foreground/25">{c.note}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
