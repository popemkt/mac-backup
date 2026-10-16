/**
 * How this browser writes numbers: grouped for reading, ungrouped for
 * editing, and read back in the same separators (`parseTypedValue`'s
 * `NumberSeparators`), so what a number slot shows is what it accepts.
 *
 * The locale is the browser's (`navigator.language`). A number format per
 * field (plain / percent / currency) would be a field prop — nodes, like
 * everything — and is not modelled yet.
 */
import type { NumberSeparators } from "@kb/model";

function browserLocale(): string {
  return typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US";
}

const readable = new Map<string, Intl.NumberFormat>();
const editable = new Map<string, Intl.NumberFormat>();

function formatter(cache: Map<string, Intl.NumberFormat>, locale: string, grouping: boolean) {
  let f = cache.get(locale);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: 10, useGrouping: grouping });
    cache.set(locale, f);
  }
  return f;
}

/** A number as a slot shows it at rest: grouped, in the locale's separators. */
export function formatNumber(n: number, locale = browserLocale()): string {
  return formatter(readable, locale, true).format(n);
}

/** A number as a slot edits it: the locale's decimal separator, no grouping. */
export function numberEditText(n: number, locale = browserLocale()): string {
  return formatter(editable, locale, false).format(n);
}

/** The separators a number typed in this locale is read with. */
export function numberSeparators(locale = browserLocale()): NumberSeparators {
  const parts = formatter(readable, locale, true).formatToParts(1234567.5);
  return {
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    group: parts.find((p) => p.type === "group")?.value ?? "",
  };
}
