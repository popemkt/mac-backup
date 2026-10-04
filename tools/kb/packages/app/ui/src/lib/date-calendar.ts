/**
 * A date editor's month grid and its keys, as data (the pure half of
 * `components/ui/date-editor`).
 */
import { addDays, addMonths, weekday, type LocalDate } from "@kb/model";
import { lookupChord, type Chord, type KeyChordEvent } from "@kb/ui-sdk";

/** Six weeks covering `month`'s month, each starting on `firstDay` (0 = Sunday). */
export function calendarWeeks(month: LocalDate, firstDay: number): LocalDate[][] {
  const first = { ...month, day: 1 };
  const start = addDays(first, -((weekday(first) - firstDay + 7) % 7));
  return Array.from({ length: 6 }, (_week, w) =>
    Array.from({ length: 7 }, (_day, d) => addDays(start, w * 7 + d)),
  );
}

export const sameDay = (a: LocalDate, b: LocalDate): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day;

/** What a key does to the date an editor is about to set. */
export type DateEditorIntent =
  | { type: "move"; to: (date: LocalDate) => LocalDate }
  | { type: "commit" }
  | { type: "cancel" };

interface DateBinding {
  readonly chord: Chord;
  readonly intent: DateEditorIntent;
}

/**
 * ↑/↓ a day, ⇧↑/⇧↓ a week, PageUp/PageDown a month; Enter (and Tab) sets
 * the date, Escape leaves it. ←/→ stay the text's, for editing what was typed.
 */
const DATE_KEYS: readonly DateBinding[] = [
  { chord: { key: "ArrowUp", shift: true }, intent: { type: "move", to: (d) => addDays(d, -7) } },
  { chord: { key: "ArrowDown", shift: true }, intent: { type: "move", to: (d) => addDays(d, 7) } },
  { chord: { key: "ArrowUp" }, intent: { type: "move", to: (d) => addDays(d, -1) } },
  { chord: { key: "ArrowDown" }, intent: { type: "move", to: (d) => addDays(d, 1) } },
  { chord: { key: "PageUp" }, intent: { type: "move", to: (d) => addMonths(d, -1) } },
  { chord: { key: "PageDown" }, intent: { type: "move", to: (d) => addMonths(d, 1) } },
  { chord: { key: "Enter" }, intent: { type: "commit" } },
  { chord: { key: "Tab" }, intent: { type: "commit" } },
  { chord: { key: "Escape" }, intent: { type: "cancel" } },
];

export function dateEditorIntent(event: KeyChordEvent): DateEditorIntent | null {
  return lookupChord(event, DATE_KEYS)?.intent ?? null;
}
