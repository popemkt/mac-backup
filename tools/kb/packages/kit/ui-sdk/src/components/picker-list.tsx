import { useRef, type ReactNode, type RefObject } from "react";
import { CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { labelRuns, type PickerRow } from "../lib/picker";
import { useAnchoredPosition } from "./use-anchored-position";

export interface PickerListProps {
  rows: readonly PickerRow[];
  /** The highlighted row (`usePickerKeys`). */
  activeIndex: number;
  onPick: (row: PickerRow) => void;
  /** Hovering a row moves the highlight to it. */
  onHover?: (index: number) => void;
  /**
   * `popover` floats next to the input that owns the query (anchored to
   * `anchorRef` when given: fixed, flipped and clamped to the viewport);
   * `inline` is the list slot of a panel that is already a popover.
   */
  placement: "popover" | "inline";
  anchorRef?: RefObject<HTMLElement | null>;
  /** What the create row says for a name (`Create tag "x"`). */
  createLabel?: (name: string) => string;
  /** A glyph before a row's label. */
  iconOf?: (row: PickerRow) => ReactNode;
  /** Shown in place of rows when there are none. Absent: an empty list renders nothing. */
  emptyText?: string;
  /** A line of key hints under the rows. */
  hint?: string;
  "aria-label"?: string;
}

const defaultCreateLabel = (name: string): string => `Create “${name}”`;

/**
 * The one picker list: every surface that asks "which node?" draws its
 * candidates with this (see `lib/picker`). It renders what the engine
 * decided — rows, where the query matched, what is already picked, the
 * create row, the highlight — and decides nothing.
 *
 * A mousedown in the list is swallowed, so the input that owns the query
 * keeps focus (and its blur never races the pick); a row's click picks.
 */
export function PickerList({
  rows,
  activeIndex,
  onPick,
  onHover,
  placement,
  anchorRef,
  createLabel = defaultCreateLabel,
  iconOf,
  emptyText,
  hint,
  "aria-label": ariaLabel,
}: PickerListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const noAnchor = useRef<HTMLElement | null>(null);
  const anchored = placement === "popover" && anchorRef !== undefined;
  const place = useAnchoredPosition(anchorRef ?? noAnchor, listRef, anchored);
  if (rows.length === 0 && emptyText === undefined) return null;
  // Picked rows carry a check; the column is reserved only when one does.
  const checks = rows.some((row) => row.kind === "item" && row.selected);
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-multiselectable={checks || undefined}
      className={cn(
        "text-ui",
        placement === "popover"
          ? cn(
              "z-30 w-72 overflow-auto rounded-md border border-foreground/10 bg-popover p-1 shadow-lifted",
              place === undefined && "absolute left-1 top-full mt-1 max-h-60",
            )
          : "max-h-[240px] overflow-y-auto p-1",
      )}
      style={place}
      data-picker-list={placement}
      onMouseDown={(e) => e.preventDefault()}
    >
      {rows.length === 0 ? (
        <div className="px-2 py-2 text-center text-meta text-foreground/30">{emptyText}</div>
      ) : (
        rows.map((row, i) => (
          <PickerRowButton
            key={row.id}
            row={row}
            active={i === activeIndex}
            checks={checks}
            icon={iconOf?.(row)}
            createLabel={createLabel}
            onHover={() => onHover?.(i)}
            onPick={() => onPick(row)}
          />
        ))
      )}
      {hint !== undefined && rows.length > 0 && (
        <div className="sticky -bottom-1 -mx-1 -mb-1 mt-1 border-t border-foreground/[0.06] bg-popover px-3 py-1 text-caption text-foreground/25">
          {hint}
        </div>
      )}
    </div>
  );
}

function PickerRowButton({
  row,
  active,
  checks,
  icon,
  createLabel,
  onHover,
  onPick,
}: {
  row: PickerRow;
  active: boolean;
  checks: boolean;
  icon: ReactNode;
  createLabel: (name: string) => string;
  onHover: () => void;
  onPick: () => void;
}) {
  const disabled = row.kind === "item" && row.disabled;
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      aria-checked={row.kind === "item" && checks ? row.selected : undefined}
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
      onMouseEnter={onHover}
      onClick={() => {
        if (!disabled) onPick();
      }}
    >
      {checks && row.kind === "item" && (
        <span className="flex w-3 shrink-0 justify-center" aria-hidden>
          {row.selected && <CheckIcon size={11} weight="bold" />}
        </span>
      )}
      {row.kind === "create" ? (
        <span className="shrink-0 opacity-60">
          <PlusIcon size={12} weight="bold" />
        </span>
      ) : (
        icon !== undefined && icon !== null && <span className="shrink-0 opacity-50">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {row.kind === "item" ? <RowLabel row={row} /> : createLabel(row.name)}
      </span>
      {row.kind === "item" && row.note !== undefined && row.note !== "" && (
        <span className="shrink-0 text-caption text-foreground/25">{row.note}</span>
      )}
    </button>
  );
}

/** A row's label with the runs the query matched made bold. */
function RowLabel({ row }: { row: Extract<PickerRow, { kind: "item" }> }) {
  const label = row.label || row.id;
  if (row.matches.length === 0) return <>{label}</>;
  return (
    <>
      {labelRuns(label, row.matches).map((run) =>
        run.matched ? (
          <mark
            key={run.from}
            className="bg-transparent font-semibold text-inherit"
            data-picker-match="true"
          >
            {run.text}
          </mark>
        ) : (
          <span key={run.from}>{run.text}</span>
        ),
      )}
    </>
  );
}
