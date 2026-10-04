/**
 * Display text, where the empty string is a value the UI must decide about.
 *
 * An id is either there or it is not, and `!== undefined` says so. A label, a
 * colour, a title or an error message can also be present-but-empty, and every
 * such site used to spell the same `||` fallback or truthiness test. These two
 * are that spelling, once.
 */

/** True when a nullable display string has something to show. */
export function hasText(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}

/** `value` when it has something to show, `fallback` otherwise. */
export function textOr(value: string | null | undefined, fallback: string): string {
  return hasText(value) ? value : fallback;
}
