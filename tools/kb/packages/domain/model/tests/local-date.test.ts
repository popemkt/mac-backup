import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  addDays,
  addMonths,
  dayNumber,
  formatDay,
  parseDateInput,
  parseDay,
  parseTypedValue,
  weekday,
  type LocalDate,
} from "../src/index.ts";

/** A Monday. */
const TODAY: LocalDate = { year: 2026, month: 9, day: 28 };

describe("local dates", () => {
  test("a stored date is its calendar day, with no zone to slip across", () => {
    expect(parseDay("2026-09-28")).toEqual(TODAY);
    expect(formatDay(TODAY)).toBe("2026-09-28");
    for (const bad of ["2026-02-30", "2026-13-01", "2026-9-28", "28-09-2026", ""]) {
      expect(parseDay(bad)).toBeNull();
    }
    expect(parseDay("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });

  test("day arithmetic is the civil calendar's, and round-trips", () => {
    expect(dayNumber({ year: 1970, month: 1, day: 1 })).toBe(0);
    expect(weekday(TODAY)).toBe(1);
    expect(addDays(TODAY, 4)).toEqual({ year: 2026, month: 10, day: 2 });
    expect(addDays({ year: 2024, month: 3, day: 1 }, -1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    fc.assert(
      fc.property(
        fc.integer({ min: -200000, max: 200000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (n, k) => {
          const date = addDays({ year: 1970, month: 1, day: 1 }, n);
          expect(dayNumber(date)).toBe(n);
          expect(dayNumber(addDays(date, k))).toBe(n + k);
          expect(parseDay(formatDay(date))).toEqual(
            date.year >= 0 && date.year <= 9999 ? date : parseDay(formatDay(date)),
          );
        },
      ),
    );
  });

  test("a month on keeps the day, clamped to the month's length", () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addMonths({ year: 2026, month: 12, day: 5 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 5,
    });
    expect(addMonths({ year: 2026, month: 1, day: 5 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 5,
    });
  });
});

describe("typed date input", () => {
  const read = (raw: string) => parseDateInput(raw, TODAY);

  test("absolute dates read with or without a today", () => {
    expect(parseDateInput("2026-10-01")).toBe("2026-10-01");
    expect(parseDateInput("2026/10/1")).toBe("2026-10-01");
    expect(parseDateInput("2026-05-06T00:00:00.000Z")).toBe("2026-05-06");
    expect(parseDateInput("oct 3 2027")).toBe("2027-10-03");
    expect(parseDateInput("3 October, 2027")).toBe("2027-10-03");
    expect(parseDateInput("2026-02-30")).toBeNull();
    // A month and day with no year needs a today to have a year.
    expect(parseDateInput("oct 3")).toBeNull();
    expect(read("oct 3rd")).toBe("2026-10-03");
  });

  test("relative words read against today", () => {
    expect(read("today")).toBe("2026-09-28");
    expect(read("Tomorrow")).toBe("2026-09-29");
    expect(read("yesterday")).toBe("2026-09-27");
    expect(read("in 3 days")).toBe("2026-10-01");
    expect(read("in 2 weeks")).toBe("2026-10-12");
    expect(read("in 1 month")).toBe("2026-10-28");
    expect(read("2 days ago")).toBe("2026-09-26");
    expect(read("+3d")).toBe("2026-10-01");
    expect(read("-1w")).toBe("2026-09-21");
    expect(read("next week")).toBe("2026-10-05");
    expect(read("next month")).toBe("2026-10-28");
    expect(parseDateInput("tomorrow")).toBeNull();
  });

  test("a weekday is the soonest one after today; `last` the latest before", () => {
    expect(read("fri")).toBe("2026-10-02");
    expect(read("next fri")).toBe("2026-10-02");
    expect(read("monday")).toBe("2026-10-05");
    expect(read("last fri")).toBe("2026-09-25");
    expect(read("last mon")).toBe("2026-09-21");
  });

  test("what names no date is refused", () => {
    for (const raw of ["", "soon", "in days", "next", "fr", "32 oct"]) expect(read(raw)).toBeNull();
  });

  test("the date parser is the one every surface stores through", () => {
    expect(parseTypedValue("tomorrow", "date", { today: TODAY })).toEqual({
      ok: true,
      value: { t: "str", v: "2026-09-29" },
    });
    expect(parseTypedValue("soon", "date", { today: TODAY }).ok).toBe(false);
    expect(parseTypedValue("", "date")).toEqual({ ok: true, value: { t: "str", v: "" } });
  });
});
