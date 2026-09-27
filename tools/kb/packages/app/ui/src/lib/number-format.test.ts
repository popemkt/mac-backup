import { describe, expect, it } from "vitest";
import { parseTypedValue } from "@kb/model";
import { formatNumber, numberEditText, numberSeparators } from "@/lib/number-format";

describe("numbers in a locale", () => {
  it("groups for reading and not for editing", () => {
    expect(formatNumber(1234567.5, "en-US")).toBe("1,234,567.5");
    expect(numberEditText(1234567.5, "en-US")).toBe("1234567.5");
    expect(formatNumber(1234.5, "de-DE")).toBe("1.234,5");
    expect(numberEditText(1234.5, "de-DE")).toBe("1234,5");
  });

  it("reads back what it writes, in either form", () => {
    for (const locale of ["en-US", "de-DE", "fr-FR", "en-IN"]) {
      const seps = numberSeparators(locale);
      for (const n of [0, -12.25, 1234567.5]) {
        for (const text of [formatNumber(n, locale), numberEditText(n, locale)]) {
          expect(parseTypedValue(text, "number", seps)).toEqual({
            ok: true,
            value: { t: "num", v: n },
          });
        }
      }
    }
  });
});
