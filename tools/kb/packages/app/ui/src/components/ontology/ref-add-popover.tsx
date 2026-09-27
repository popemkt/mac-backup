import { useEffect, useMemo, useRef, useState } from "react";
import { pickerRows, type PickerCandidate, type PickerRow } from "@/lib/picker";
import { usePickerKeys } from "@/lib/use-picker";
import { PickerList } from "@/components/ui/picker-list";
import { PlusIcon } from "@phosphor-icons/react";
import { isOutside } from "@/lib/dom";

interface RefAddPopoverProps {
  /** Button label, e.g. "+ tag". */
  trigger: string;
  title: string;
  candidates: PickerCandidate[];
  onPick: (id: string) => void;
  emptyHint?: string;
}

/**
 * The ontology page's "add a ref" popover for its include / extends rows: a
 * trigger and a panel around the one node picker (lib/picker) — the same
 * matching, keys and list every other "which node?" surface uses.
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
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () => pickerRows(candidates, { query: filter, limit: 40 }),
    [candidates, filter],
  );

  const commit = (row: PickerRow | null) => {
    if (row?.kind !== "item" || row.disabled) return;
    onPick(row.id);
    setOpen(false);
  };

  const keys = usePickerKeys({
    rows,
    query: filter,
    onPick: commit,
    onCancel: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) return;
    setFilter("");
    // Focus after paint so the popover is mounted.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (isOutside(rootRef.current, e.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-[18px] items-center gap-0.5 rounded-sm border border-dashed border-foreground/15 px-1.5 text-label text-foreground/40 transition-colors duration-100 hover:border-foreground/30 hover:text-foreground/70"
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon size={9} weight="bold" />
        {trigger}
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-40 mt-1 w-[260px] rounded-lg border border-foreground/10 bg-popover p-1 shadow-overlay"
          role="dialog"
          aria-label={title}
        >
          <input
            ref={inputRef}
            value={filter}
            placeholder={title}
            aria-label={title}
            className="mb-1 w-full rounded-md bg-foreground/[0.04] px-2 py-1 text-meta text-foreground/85 outline-none placeholder:text-foreground/30"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              keys.handleKeyDown(e);
            }}
          />
          <PickerList
            placement="inline"
            rows={rows}
            activeIndex={keys.activeIndex}
            onHover={keys.setActiveIndex}
            onPick={commit}
            emptyText={emptyHint}
            aria-label={title}
          />
        </div>
      ) : null}
    </div>
  );
}
