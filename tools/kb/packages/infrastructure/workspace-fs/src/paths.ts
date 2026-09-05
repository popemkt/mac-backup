import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { isValidWorkspaceName } from "@kb/contracts";

/**
 * Where the three workspace ports keep their bytes, and the one rule they all
 * enforce: a name is an id, never a path. Every resolver below turns a name
 * into an absolute path inside its own directory or returns null — traversal,
 * absolute names, nested segments and separator tricks all land on null.
 *
 * This is the half of `.kb/` that a browser cannot have. It lives here rather
 * than beside the use cases so that the use cases stay isomorphic.
 */

/** Markdown / HTTP path prefix that node text uses to reference an asset. */
export const ASSETS_URL_PREFIX = "assets/";

export function queriesDir(root: string): string {
  return resolve(root, ".kb", "queries");
}

export function viewsDir(root: string): string {
  return resolve(root, ".kb", "views");
}

export function assetsDir(root: string): string {
  return join(root, ".kb", "assets");
}

/**
 * `<dir>/<name><ext>` when `name` addresses exactly that file and nothing
 * else. Two independent checks, because neither alone is enough: the name
 * grammar rejects `a/b`, `..`, spaces and control characters, and the
 * containment check rejects anything that normalises its way out of `dir`.
 */
function resolveInDir(dir: string, name: string, ext: string): string | null {
  if (!isValidWorkspaceName(name)) return null;
  const candidate = normalize(join(dir, `${name}${ext}`));
  const rel = relative(dir, candidate);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (rel !== `${name}${ext}`) return null;
  return candidate;
}

export function resolveSavedQueryFile(root: string, name: string): string | null {
  return resolveInDir(queriesDir(root), name, ".edn");
}

export function resolveViewFile(root: string, name: string): string | null {
  return resolveInDir(viewsDir(root), name, ".json");
}

/**
 * Resolve `GET /assets/<name>` (or bare `assets/<name>`) to an absolute file
 * path under `.kb/assets`. Returns null on traversal / empty name.
 *
 * Unlike a saved query or a view, an asset name may be nested: the store is
 * opaque and Logseq-style layouts put files in subdirectories.
 */
export function resolveAssetFile(root: string, pathname: string): string | null {
  let rel = pathname.trim();
  if (rel.startsWith("/")) rel = rel.slice(1);
  if (rel.startsWith(ASSETS_URL_PREFIX)) {
    rel = rel.slice(ASSETS_URL_PREFIX.length);
  } else {
    return null;
  }

  // Reject empty / NUL; decode %2e%2e / %2f style escapes before segmenting.
  if (!rel || rel.includes("\0")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const segments = decoded.split(/[/\\]+/).filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === "." || s === "..")) return null;

  const rootResolved = resolve(assetsDir(root));
  const candidate = normalize(join(rootResolved, ...segments));
  // relative() is separator-agnostic; escapes show up as ".." or absolute.
  const relFromRoot = relative(rootResolved, candidate);
  if (
    relFromRoot === "" || // the directory itself is not a file we serve
    relFromRoot.startsWith("..") ||
    isAbsolute(relFromRoot)
  ) {
    return null;
  }
  return candidate;
}

/** The stem of a `<name><ext>` directory entry, or null when it is not one. */
export function stemOf(entry: string, ext: string): string | null {
  if (!entry.endsWith(ext)) return null;
  const stem = entry.slice(0, -ext.length);
  return stem === "" ? null : stem;
}
