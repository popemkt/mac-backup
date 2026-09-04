/**
 * The ui's one diagnostic output seam.
 *
 * Every message that would otherwise reach the browser console goes through
 * here, so `eslint/no-console` stays on for the rest of the package and there
 * is a single place to route diagnostics somewhere better later. The oxlint
 * override that allows `console` names this file and nothing else.
 */

export function logWarn(...args: readonly unknown[]): void {
  // oxlint-disable-next-line eslint/no-console -- this module is the browser log seam
  console.warn(...args);
}

export function logError(...args: readonly unknown[]): void {
  // oxlint-disable-next-line eslint/no-console -- this module is the browser log seam
  console.error(...args);
}
