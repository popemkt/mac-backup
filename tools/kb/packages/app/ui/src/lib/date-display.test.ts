import { describe, expect, it } from "vitest";
import type { LocalDate } from "@kb/model";
import { relativeDateLabel, todayLocal, weekdayInitials } from "@/lib/date-display";

/** A Monday. */
const TODAY: LocalDate = { year: 2026, month: 9, day: 28 };
const label = (date: LocalDate) => relativeDateLabel(date, TODAY, "en-US");

describe("a date's label", () => {
  it("names the days next to today by their relation to it", () => {
    expect(label(TODAY)).toBe("Today");
    expect(label({ year: 2026, month: 9, day: 29 })).toBe("Tomorrow");
    expect(label({ year: 2026, month: 9, day: 27 })).toBe("Yesterday");
  });

  it("names the rest of the coming week by its weekday", () => {
    expect(label({ year: 2026, month: 10, day: 2 })).toBe("Fri");
    expect(label({ year: 2026, month: 10, day: 5 })).toBe("Mon");
  });

  it("names other dates by month and day, with the year only when it is not this one", () => {
    expect(label({ year: 2026, month: 10, day: 12 })).toBe("Oct 12");
    expect(label({ year: 2026, month: 9, day: 1 })).toBe("Sep 1");
    expect(label({ year: 2027, month: 1, day: 3 })).toBe("Jan 3, 2027");
  });

  it("reads the calendar day, not a UTC instant", () => {
    // Whatever the zone the test runs in, a date's label is its own day.
    expect(label({ year: 2026, month: 3, day: 4 })).toBe("Mar 4");
  });

  it("takes today from the local clock", () => {
    expect(todayLocal(new Date(2026, 8, 28, 23, 59))).toEqual(TODAY);
    expect(todayLocal(new Date(2026, 8, 28, 0, 1))).toEqual(TODAY);
  });

  it("heads a calendar with the locale's weekday initials from its first day", () => {
    expect(weekdayInitials(0, "en-US")).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
    expect(weekdayInitials(1, "en-US")[0]).toBe("M");
  });
});
