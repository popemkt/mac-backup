import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import {
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";

/**
 * Saved-query file names under `.kb/queries/<name>.edn`.
 * Matches CLI `kb run` historically: letters/digits/`_`/`.`/`-`, must start
 * with a word char. Rejects traversal, spaces, control chars, and empty.
 */
export const SAVED_QUERY_NAME_RE = /^[\w][\w.-]*$/;

export function isValidSavedQueryName(name: string): boolean {
  return typeof name === "string" && SAVED_QUERY_NAME_RE.test(name);
}

export function queriesDir(root: string): string {
  return resolve(root, ".kb", "queries");
}

/**
 * Resolve `.kb/queries/<name>.edn` when `name` is a safe saved-query id.
 * Returns null for traversal / control / ambiguous names so callers never
 * touch a path outside the queries directory.
 */
export function resolveSavedQueryFile(
  root: string,
  name: string,
): string | null {
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
export async function readSavedQuery(
  root: string,
  name: string,
): Promise<string | null> {
  const path = resolveSavedQueryFile(root, name);
  if (!path) return null;
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Create/overwrite a saved query file. Returns false when the name is invalid. */
export async function saveSavedQuery(
  root: string,
  name: string,
  edn: string,
): Promise<boolean> {
  const path = resolveSavedQueryFile(root, name);
  if (!path) return false;
  await mkdir(queriesDir(root), { recursive: true });
  await writeFile(path, edn, "utf8");
  return true;
}

/** Delete a saved query file. Returns false when the name is invalid. */
export async function deleteSavedQuery(
  root: string,
  name: string,
): Promise<boolean> {
  const path = resolveSavedQueryFile(root, name);
  if (!path) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}
