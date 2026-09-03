/** datascript ships no types; the js-facing API surface kb uses is tiny.
 * One shim for the whole workspace: it travels with `datascript.ts` through a
 * triple-slash reference, so every project that type-checks @kb/query gets it. */
declare module "datascript" {
  export function init_db(datoms: unknown[], schema?: unknown): unknown;
  export function q(query: string, ...inputs: unknown[]): unknown;
  export function pull(db: unknown, pattern: string, eid: unknown): unknown;
}
