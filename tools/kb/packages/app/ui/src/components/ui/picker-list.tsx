import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { PickerRow } from "@/lib/picker";

export interface PickerListProps {
  rows: readonly PickerRow[];
  /** The highlighted row (`usePickerKeys`). */
  activeIndex: number;
  onPick: (row: PickerRow) => void;
  /** Hovering a row moves the highlight to it. */
  onHover?: (index: number) => void;
  /**
   * `popover` floats under the input that owns the query; `inline` is the
   * list slot of a panel that is already a popover (the node palette).
   */
  placement: "popover" | "inline";
  /** What the create row says for a name (`Create tag "x"`). */
  createLabel?: (name: string) => string;
  /** A glyph before a row's label. */
  iconOf?: (row: PickerRow) => ReactNode;
  /** Shown in place of rows when there are none. Absent: an empty list renders nothing. */
  emptyText?: string;
  "aria-label"?: string;
}

const defaultCreateLabel = (name: string): string => `Create "${name}"`;

/**
 * The one picker list: every surface that asks "which node?" draws its
 * candidates with this (see `lib/picker`). It renders what the engine
 * decided — rows, the highlight, the create row — and decides nothing.
 *
 * A row's mousedown is swallowed, so the input that owns the query keeps
 * focus (and its blur never races the pick); the click picks.
 */
export function PickerList({
  rows,
  activeIndex,
  onPick,
  onHover,
  placement,
  createLabel = defaultCreateLabel,
  iconOf,
  emptyText,
  "aria-label": ariaLabel,
}: PickerListProps) {
  if (rows.length === 0 && emptyText === undefined) return null;
  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className={cn(
        "text-ui",
        placement === "popover"
          ? cn(
              "absolute left-1 top-full z-20 mt-1 max-h-48 w-72 overflow-auto",
              "rounded-md border border-foreground/10 bg-popover p-1 shadow-lifted",
            )
          : "max-h-[240px] overflow-y-auto p-1",
      )}
      data-picker-list={placement}
    >
      {rows.length === 0 ? (
        <div className="px-2 py-2 text-center text-meta text-foreground/25">{emptyText}</div>
      ) : (
        rows.map((row, i) => {
          const active = i === activeIndex;
          const disabled = row.kind === "item" && row.disabled;
          const icon = iconOf?.(row);
          return (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={active}
              aria-disabled={disabled || undefined}
              data-picker-id={row.kind === "item" ? row.id : undefined}
              data-picker-create={row.kind === "create" ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                "transition-colors duration-75",
                disabled
                  ? "cursor-not-allowed text-foreground/25"
                  : active
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground/75 hover:bg-foreground/[0.04]",
              )}
              onMouseEnter={() => onHover?.(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!disabled) onPick(row);
              }}
            >
              {icon !== undefined && icon !== null && (
                <span className="shrink-0 opacity-50">{icon}</span>
              )}
              <span className="min-w-0 flex-1 truncate">
                {row.kind === "item" ? row.label || row.id : createLabel(row.name)}
              </span>
              {row.kind === "item" && row.note !== undefined && row.note !== "" && (
                <span className="shrink-0 text-caption text-foreground/25">{row.note}</span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
