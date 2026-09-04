import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";

/**
 * Saved-query file names under `.kb/queries/<name>.edn`.
 * Matches CLI `kb run` historically: letters/digits/`_`/`.`/`-`, must start
 * with a word char. Rejects traversal, spaces, control chars, and empty.
 */
const SAVED_QUERY_NAME_RE = /^[\w][\w.-]*$/;

export function isValidSavedQueryName(name: string): boolean {
  return typeof name === "string" && SAVED_QUERY_NAME_RE.test(name);
}

function queriesDir(root: string): string {
  return resolve(root, ".kb", "queries");
}

/**
 * Resolve `.kb/queries/<name>.edn` when `name` is a safe saved-query id.
 * Returns null for traversal / control / ambiguous names so callers never
 * touch a path outside the queries directory.
 */
export function resolveSavedQueryFile(root: string, name: string): string | null {
  if (!isValidSavedQueryName(name)) return null;
  const dir = queriesDir(root);
  const candidate = normalize(join(dir, `${name}.edn`));
  const rel = relative(dir, candidate);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  // Basename must be exactly `<name>.edn` (no extra segments slipped in).
  if (rel !== `${name}.edn`) return null;
  return candidate;
}

/** Read a saved query; null when the name is invalid or the file is missing. */
export const readSavedQuery = Effect.fn("kb.readSavedQuery")(function* (
  root: string,
  name: string,
): Effect.fn.Return<string | null, never, FileSystem> {
  const path = resolveSavedQueryFile(root, name);
  if (path === null) return null;
  const fs = yield* FileSystem;
  return yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => null));
});

/** Create/overwrite a saved query file. Returns false when the name is invalid. */
export const saveSavedQuery = Effect.fn("kb.saveSavedQuery")(function* (
  root: string,
  name: string,
  edn: string,
): Effect.fn.Return<boolean, PlatformError, FileSystem> {
  const path = resolveSavedQueryFile(root, name);
  if (path === null) return false;
  const fs = yield* FileSystem;
  yield* fs.makeDirectory(queriesDir(root), { recursive: true });
  yield* fs.writeFileString(path, edn);
  return true;
});

/** Delete a saved query file. Returns false when the name is invalid. */
export const deleteSavedQuery = Effect.fn("kb.deleteSavedQuery")(function* (
  root: string,
  name: string,
): Effect.fn.Return<boolean, never, FileSystem> {
  const path = resolveSavedQueryFile(root, name);
  if (path === null) return false;
  const fs = yield* FileSystem;
  return yield* fs.remove(path).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
});
