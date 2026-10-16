/**
 * How a date value reads: near today by its relation to today, otherwise by
 * its calendar date — and always from its local calendar day, never from a
 * UTC instant (`new Date("2026-09-28")` is the 27th west of Greenwich).
 */
import { addDays, dayNumber, type LocalDate } from "@kb/model";

function browserLocale(): string {
  return typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US";
}

/** Today on this browser's clock, as a calendar date. */
export function todayLocal(now: Date = new Date()): LocalDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** Local midnight of a calendar date, for `Intl` to name. */
function asLocalInstant({ year, month, day }: LocalDate): Date {
  return new Date(year, month - 1, day);
}

/**
 * `Today`, `Tomorrow`, `Yesterday`; a weekday for the six days after
 * tomorrow; `Sep 28` within this year; `Sep 28, 2027` otherwise.
 */
export function relativeDateLabel(
  date: LocalDate,
  today: LocalDate = todayLocal(),
  locale = browserLocale(),
): string {
  const delta = dayNumber(date) - dayNumber(today);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (delta >= -1 && delta <= 1) return capitalize(relative.format(delta, "day"), locale);
  const at = asLocalInstant(date);
  if (delta > 1 && delta <= 7)
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(at);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.year === today.year ? {} : { year: "numeric" }),
  }).format(at);
}

/** The full date, for a title: `Monday, September 28, 2026`. */
export function longDateLabel(date: LocalDate, locale = browserLocale()): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(asLocalInstant(date));
}

function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** The month's name and year, for a calendar's header. */
export function monthLabel(date: LocalDate, locale = browserLocale()): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    asLocalInstant({ ...date, day: 1 }),
  );
}

/** Narrow weekday names, from `firstDay` (0 = Sunday), for a calendar's head row. */
export function weekdayInitials(firstDay: number, locale = browserLocale()): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  // 2026-09-27 is a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(asLocalInstant(addDays({ year: 2026, month: 9, day: 27 }, firstDay + i))),
  );
}

/** The locale's first day of the week (0 = Sunday), Monday when the browser cannot say. */
export function firstDayOfWeek(locale = browserLocale()): number {
  try {
    // `getWeekInfo` is missing from some engines; calling it there throws.
    return new Intl.Locale(locale).getWeekInfo().firstDay % 7;
  } catch {
    return 1;
  }
}
