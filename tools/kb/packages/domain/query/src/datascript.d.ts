/** datascript ships no types; the js-facing API surface kb uses is tiny.
 * One shim for the whole workspace: it travels with the two modules that
 * import `datascript` (`datascript.ts`, `index/datoms.ts`) through a
 * triple-slash reference, so every project that type-checks @kb/query gets it.
 *
 * The reference is the seam: this file is an ambient script (`declare module`),
 * so an `import` of it would turn it into a module and demote the declaration
 * to an augmentation of a module that has no types. Those two files are
 * therefore where `typescript/triple-slash-reference` is off. */
declare module "datascript" {
  export function init_db(datoms: unknown[], schema?: unknown): unknown;
  export function q(query: string, ...inputs: unknown[]): unknown;
  export function pull(db: unknown, pattern: string, eid: unknown): unknown;
  export function db_with(db: unknown, txData: unknown[]): unknown;
  /** Datoms of one index, as datascript hands them to JS: entity, attr, value. */
  export function datoms(
    db: unknown,
    index: string,
    ...components: unknown[]
  ): Array<{ e: number; a: string; v: unknown }>;
}
