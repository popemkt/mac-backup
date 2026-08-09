/** datascript ships no types; the js-facing API surface the backend uses is tiny. */
declare module "datascript" {
  export function init_db(datoms: unknown[], schema?: unknown): unknown;
  export function q(query: string, ...inputs: unknown[]): unknown;
  export function pull(db: unknown, pattern: string, eid: unknown): unknown;
}
