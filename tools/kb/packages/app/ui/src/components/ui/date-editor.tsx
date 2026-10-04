import { useRef, useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { addMonths, formatDay, parseDateInput, parseDay, type LocalDate } from "@kb/model";
import { cn, IconButton, KB_TEXT_CLASS, useAnchoredPosition } from "@kb/ui-sdk";
import { calendarWeeks, dateEditorIntent, sameDay } from "@/lib/date-calendar";
import {
  firstDayOfWeek,
  longDateLabel,
  monthLabel,
  todayLocal,
  weekdayInitials,
} from "@/lib/date-display";

export interface DateEditorProps {
  /** What the input starts with: the stored date, or input the slot kept. */
  initialText: string;
  /** Leave with what is typed (or picked): the slot parses and commits it. */
  onCommit: (text: string) => void;
  /** Leave without changing anything. */
  onCancel: () => void;
}

/**
 * A date, typed or picked: a text input that reads phrases (`tomorrow`,
 * `next fri`, `oct 3`, `in 2 weeks` — `parseDateInput`, the reader every
 * surface shares) with a live preview of the date it names, over a calendar
 * that follows it. Keyboard-first: ↑/↓ move a day, ⇧↑/⇧↓ a week,
 * PageUp/PageDown a month, Enter or Tab sets it, Escape leaves; the pointer
 * picks a day. The calendar is anchored below the input and flips above it
 * when there is no room.
 */
export function DateEditor({ initialText, onCommit, onCancel }: DateEditorProps) {
  const today = todayLocal();
  const [text, setText] = useState(initialText);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const place = useAnchoredPosition(inputRef, panelRef, true);

  const typed = parseDateInput(text, today);
  const preview = typed === null ? null : parseDay(typed);
  /** The date keys move from: what is typed, else today. */
  const current = preview ?? today;
  /** The month the calendar shows: the typed date's, until the arrows page it. */
  const [month, setShownMonth] = useState<LocalDate>(current);

  const setDate = (date: LocalDate) => {
    setText(formatDay(date));
    setShownMonth(date);
  };

  return (
    <div className="relative min-w-0 flex-1" data-date-editor="true">
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder="today, next fri, oct 3…"
        aria-label="Date"
        aria-invalid={text.trim() !== "" && preview === null ? true : undefined}
        className={cn(
          "w-full rounded-sm border-none bg-transparent px-1 outline-none",
          KB_TEXT_CLASS,
          "text-foreground/70 placeholder:text-foreground/25",
        )}
        autoFocus
        onChange={(e) => {
          setText(e.target.value);
          const named = parseDateInput(e.target.value, today);
          const date = named === null ? null : parseDay(named);
          if (date !== null) setShownMonth(date);
        }}
        onBlur={() => {
          if (text === initialText) onCancel();
          else onCommit(text);
        }}
        onKeyDown={(e) => {
          // The outline behind this input must not also act on these keys.
          e.stopPropagation();
          const intent = dateEditorIntent(e);
          if (intent === null) return;
          e.preventDefault();
          if (intent.type === "move") setDate(intent.to(current));
          else if (intent.type === "commit") onCommit(text);
          else onCancel();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Calendar"
        className={cn(
          "z-30 w-60 overflow-auto rounded-lg border border-foreground/10 bg-popover p-2 shadow-overlay",
          place === undefined && "absolute left-0 top-full mt-1",
        )}
        style={place}
        // The input keeps focus: a click in the calendar must not blur it.
        onMouseDown={(e) => e.preventDefault()}
      >
        <p
          className={cn(
            "mb-1.5 truncate px-1 text-meta",
            preview === null && text.trim() !== "" ? "text-warning" : "text-foreground/50",
          )}
          data-date-preview="true"
        >
          {preview !== null
            ? longDateLabel(preview)
            : text.trim() === ""
              ? "Type a date, or pick one"
              : "Not a date yet"}
        </p>
        <CalendarMonth
          month={month}
          picked={preview}
          today={today}
          onPage={(n) => setShownMonth(addMonths(month, n))}
          onPick={(day) => onCommit(formatDay(day))}
        />
        <p className="mt-1.5 px-1 text-caption text-foreground/25">
          ↑↓ day · ⇧↑↓ week · PgUp/PgDn month · ↵ set · esc
        </p>
      </div>
    </div>
  );
}

/** A month of days: its name and paging, the weekday heads, and a button per day. */
function CalendarMonth({
  month,
  picked,
  today,
  onPage,
  onPick,
}: {
  month: LocalDate;
  picked: LocalDate | null;
  today: LocalDate;
  onPage: (months: number) => void;
  onPick: (day: LocalDate) => void;
}) {
  const firstDay = firstDayOfWeek();
  return (
    <>
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-ui font-medium text-foreground/75">{monthLabel(month)}</span>
        <span className="flex gap-0.5">
          <IconButton
            label="Previous month"
            icon={CaretLeftIcon}
            tabIndex={-1}
            onClick={() => onPage(-1)}
          />
          <IconButton
            label="Next month"
            icon={CaretRightIcon}
            tabIndex={-1}
            onClick={() => onPage(1)}
          />
        </span>
      </div>
      <div role="grid" aria-label={monthLabel(month)} className="grid grid-cols-7 gap-px">
        {weekdayInitials(firstDay).map((initial, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- a weekday's column is its identity
          <span key={i} className="py-0.5 text-center text-caption text-foreground/30">
            {initial}
          </span>
        ))}
        {calendarWeeks(month, firstDay)
          .flat()
          .map((day) => {
            const isPicked = picked !== null && sameDay(day, picked);
            const inMonth = day.month === month.month;
            return (
              <button
                key={formatDay(day)}
                type="button"
                tabIndex={-1}
                role="gridcell"
                aria-selected={isPicked}
                aria-label={longDateLabel(day)}
                data-date={formatDay(day)}
                className={cn(
                  "h-7 rounded-md text-center text-meta tabular-nums transition-colors duration-75",
                  isPicked
                    ? "bg-accent text-accent-foreground font-medium"
                    : inMonth
                      ? "text-foreground/75 hover:bg-foreground/[0.06]"
                      : "text-foreground/25 hover:bg-foreground/[0.04]",
                  sameDay(day, today) && !isPicked && "ring-1 ring-primary/40",
                )}
                onClick={() => onPick(day)}
              >
                {day.day}
              </button>
            );
          })}
      </div>
    </>
  );
}
