import { describe, expect, it } from "vitest";
import { formatDay, type LocalDate } from "@kb/model";
import { calendarWeeks, dateEditorIntent, sameDay } from "@/lib/date-calendar";

const TODAY: LocalDate = { year: 2026, month: 9, day: 28 };

describe("the month grid", () => {
  it("covers the month in six weeks from the locale's first day", () => {
    const weeks = calendarWeeks(TODAY, 1);
    expect(weeks).toHaveLength(6);
    // September 2026 starts on a Tuesday: a Monday-first grid opens on Aug 31.
    expect(formatDay(weeks[0]?.[0] as LocalDate)).toBe("2026-08-31");
    expect(weeks.flat().some((d) => sameDay(d, TODAY))).toBe(true);
    const sundayFirst = calendarWeeks(TODAY, 0);
    expect(formatDay(sundayFirst[0]?.[0] as LocalDate)).toBe("2026-08-30");
  });
});

describe("the date editor's keys", () => {
  const moved = (key: string, shiftKey = false) => {
    const intent = dateEditorIntent({ key, shiftKey });
    return intent?.type === "move" ? formatDay(intent.to(TODAY)) : intent?.type;
  };

  it("move the date by a day, a week and a month", () => {
    expect(moved("ArrowDown")).toBe("2026-09-29");
    expect(moved("ArrowUp")).toBe("2026-09-27");
    expect(moved("ArrowDown", true)).toBe("2026-10-05");
    expect(moved("ArrowUp", true)).toBe("2026-09-21");
    expect(moved("PageDown")).toBe("2026-10-28");
    expect(moved("PageUp")).toBe("2026-08-28");
  });

  it("set it on Enter or Tab, leave it on Escape, and leave ←/→ to the text", () => {
    expect(moved("Enter")).toBe("commit");
    expect(moved("Tab")).toBe("commit");
    expect(moved("Escape")).toBe("cancel");
    expect(dateEditorIntent({ key: "ArrowLeft" })).toBeNull();
  });
});
