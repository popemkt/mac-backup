/**
 * Calendar dates as kb stores them: a local `YYYY-MM-DD` string, with no time
 * and no zone. `2026-09-28` is the 28th wherever it is read — which is what
 * handing "2026-09-28" to the `Date` constructor got wrong: that is UTC
 * midnight, the day before anywhere west of Greenwich. Arithmetic here is on
 * the civil calendar, never on instants.
 *
 * Also the one reader of typed date input, relative words included, so the
 * UI's date slot and any other surface that passes "today" accept the same
 * phrases. Pure: "today" is always passed in.
 */

/** A calendar date. `month` is 1–12. */
export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function valid(year: number, month: number, day: number): LocalDate | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** A stored `YYYY-MM-DD` as a date, or null when it is not one (`2026-02-30`). */
export function parseDay(text: string): LocalDate | null {
  const m = ISO_DATE.exec(text);
  if (m === null) return null;
  return valid(Number(m[1]), Number(m[2]), Number(m[3]));
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** A date as kb stores it. */
export function formatDay({ year, month, day }: LocalDate): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Days since 1970-01-01 on the civil calendar (proleptic Gregorian). */
export function dayNumber({ year, month, day }: LocalDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date `n` days after (before, when negative) `date`. */
export function addDays(date: LocalDate, n: number): LocalDate {
  const z = dayNumber(date) + n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** The same day `n` months on, clamped to the target month's length. */
export function addMonths(date: LocalDate, n: number): LocalDate {
  const index = date.year * 12 + (date.month - 1) + n;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: LocalDate): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** The short forms people type beside the three-letter one. */
const EXTRA_SHORT: Readonly<Record<string, string>> = {
  sept: "september",
  tues: "tuesday",
  weds: "wednesday",
  thur: "thursday",
  thurs: "thursday",
};

/** Where `word` names one of `names` — in full, by its first three letters, or a common short form. */
function nameIndex(names: readonly string[], word: string): number | null {
  const full = EXTRA_SHORT[word] ?? word;
  const i = names.findIndex(
    (name) => name === full || (full.length === 3 && name.startsWith(full)),
  );
  return i === -1 ? null : i;
}

const UNITS: Readonly<Record<string, "day" | "week" | "month" | "year">> = {
  d: "day",
  day: "day",
  days: "day",
  w: "week",
  wk: "week",
  week: "week",
  weeks: "week",
  mo: "month",
  month: "month",
  months: "month",
  y: "year",
  yr: "year",
  year: "year",
  years: "year",
};

function monthOf(word: string): number | null {
  const i = nameIndex(MONTHS, word);
  return i === null ? null : i + 1;
}

function weekdayOf(word: string): number | null {
  return nameIndex(WEEKDAYS, word);
}

function shift(today: LocalDate, n: number, unit: "day" | "week" | "month" | "year"): LocalDate {
  if (unit === "day") return addDays(today, n);
  if (unit === "week") return addDays(today, 7 * n);
  return addMonths(today, unit === "month" ? n : 12 * n);
}

/** `fri`: the soonest Friday after today; `last fri`: the latest before it. */
function nearestWeekday(today: LocalDate, target: number, direction: 1 | -1): LocalDate {
  const delta =
    direction === 1
      ? (target - weekday(today) + 7) % 7 || 7
      : -((weekday(today) - target + 7) % 7 || 7);
  return addDays(today, delta);
}

/**
 * `oct 3`, `3 october`, `oct 3rd 2027`, `3 oct 2027`. Without a year it is
 * `thisYear`'s, and without that there is no date to name.
 */
function monthDay(words: readonly string[], thisYear: number | null): LocalDate | null {
  if (words.length < 2 || words.length > 3) return null;
  const month = words.map(monthOf).find((m) => m !== null) ?? null;
  if (month === null) return null;
  const numbers = words
    .map((w) => /^(\d{1,4})(st|nd|rd|th)?$/.exec(w)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  if (numbers.length !== words.length - 1) return null;
  const [day, year = thisYear] = numbers;
  if (day === undefined || year === null || day > 31) return null;
  return valid(year, month, day);
}

/**
 * Typed date input as a stored date, or null when it names none.
 *
 * Reads a stored `YYYY-MM-DD` (and the date part of an ISO timestamp, the
 * form some older values hold), `YYYY/MM/DD`, a month and day (`oct 3`,
 * `3 october 2027`), and — relative to `today` — `today`, `tomorrow`,
 * `yesterday`, a weekday (`fri`: the soonest one after today; `last fri`),
 * `next week|month|year`, `in 3 days`, `2 weeks ago`, `+3d` and `-1w`.
 * Relative input needs `today`; without it only absolute dates are read.
 */
export function parseDateInput(raw: string, today?: LocalDate): string | null {
  const text = raw.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (text === "") return null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(t.*)?$/.exec(text);
  if (iso) {
    const date = valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date === null ? null : formatDay(date);
  }
  const words = text.split(" ");
  const absolute = monthDay(words, today?.year ?? null);
  if (absolute !== null) return formatDay(absolute);
  if (today === undefined) return null;
  const relative = relativeDay(words, today);
  return relative === null ? null : formatDay(relative);
}

type Phrase = (words: readonly string[], today: LocalDate) => LocalDate | null;

const NAMED_DAYS: Readonly<Record<string, number>> = {
  today: 0,
  tod: 0,
  now: 0,
  tomorrow: 1,
  tmr: 1,
  tom: 1,
  yesterday: -1,
  yday: -1,
};

/**
 * The relative phrases, each one reader, tried in order: a named day, a
 * signed offset (`+3d`), a weekday, `next|last|this <weekday|unit>`,
 * `in <n> <unit>` and `<n> <unit> ago`.
 */
const PHRASES: readonly Phrase[] = [
  ([first = "", ...rest], today) => {
    const offset = rest.length === 0 ? NAMED_DAYS[first] : undefined;
    return offset === undefined ? null : addDays(today, offset);
  },
  ([first = "", ...rest], today) => {
    const signed = rest.length === 0 ? /^([+-])(\d+)([a-z]+)$/.exec(first) : null;
    const unit = signed === null ? undefined : UNITS[signed[3] ?? ""];
    if (signed === null || unit === undefined) return null;
    return shift(today, Number(signed[2]) * (signed[1] === "-" ? -1 : 1), unit);
  },
  ([first = "", ...rest], today) => {
    const wd = rest.length === 0 ? weekdayOf(first) : null;
    return wd === null ? null : nearestWeekday(today, wd, 1);
  },
  (words, today) => {
    const [which = "", what = ""] = words;
    if (words.length !== 2 || !["next", "last", "this"].includes(which)) return null;
    const direction = which === "last" ? -1 : 1;
    const wd = weekdayOf(what);
    if (wd !== null) return nearestWeekday(today, wd, direction);
    const unit = UNITS[what];
    return unit === undefined || which === "this" ? null : shift(today, direction, unit);
  },
  (words, today) => {
    const [first = "", n = "", word = ""] = words;
    const unit = UNITS[word];
    if (words.length !== 3 || first !== "in" || !/^\d+$/.test(n) || unit === undefined) return null;
    return shift(today, Number(n), unit);
  },
  (words, today) => {
    const [n = "", word = "", last = ""] = words;
    const unit = UNITS[word];
    if (words.length !== 3 || last !== "ago" || !/^\d+$/.test(n) || unit === undefined) return null;
    return shift(today, -Number(n), unit);
  },
];

function relativeDay(words: readonly string[], today: LocalDate): LocalDate | null {
  for (const phrase of PHRASES) {
    const date = phrase(words, today);
    if (date !== null) return date;
  }
  return null;
}
