/** datascript ships no types; the js-facing API surface kb uses is tiny.
 * One shim for the whole workspace: it travels with `datascript.ts` through a
 * triple-slash reference, so every project that type-checks @kb/query gets it.
 *
 * The reference is the seam: this file is an ambient script (`declare module`),
 * so an `import` of it would turn it into a module and demote the declaration
 * to an augmentation of a module that has no types. `datascript.ts` is
 * therefore the one file where `typescript/triple-slash-reference` is off. */
declare module "datascript" {
  export function init_db(datoms: unknown[], schema?: unknown): unknown;
  export function q(query: string, ...inputs: unknown[]): unknown;
  export function pull(db: unknown, pattern: string, eid: unknown): unknown;
}
