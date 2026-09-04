/**
 * Import-derived package edges.
 *
 * Measured on this workspace: `nx graph` gives us the projects and their tags,
 * but its dependency edges are **manifest-derived only** — dropping
 * `@kb/query` from @kb/operations' package.json removed the edge even though
 * every other file in that package imports it, and adding an import without a
 * manifest entry added no edge. Nx's TypeScript locator needs `@nx/js`, which
 * would drag a plugin stack in for one job.
 *
 * So the boundary check reads both: Nx for projects and tags, this scanner for
 * what the code actually does. The scan is the authority on edges; the
 * manifests are checked against it separately, because a package that imports
 * something it does not declare only resolves by accident of hoisting.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_ROOT, packageDirs } from "./workspace.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", "storybook-static", ".nx"]);
const SOURCE_EXT = [".ts", ".tsx"];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\(\s*)(['"])([^'"\n]+)\1/g;

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/g;

/**
 * Comments talk about imports — every red-case docstring in this package
 * names one — so a scanner that reads them reports edges nobody wrote.
 */
function stripComments(source: string): string {
  return source.replace(COMMENTS, (_match, prefix?: string) =>
    prefix === undefined ? "" : prefix,
  );
}

/** One import statement: the package it sits in, the raw specifier, the file. */
export interface ImportSite {
  source: string;
  specifier: string;
  /** Package-relative file that carries the import (`<dir>/src/…`). */
  file: string;
}

export interface ImportEdge {
  source: string;
  target: string;
  /** Package-relative file that carries the import. */
  file: string;
}

/** Every `.ts`/`.tsx` file under a directory, derived output skipped. */
export function* sourceFilesUnder(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* sourceFilesUnder(full);
    } else if (SOURCE_EXT.some((ext) => entry.endsWith(ext))) {
      yield full;
    }
  }
}

/** Every module specifier one source file imports from. */
export function specifiersOf(source: string): string[] {
  const out: string[] = [];
  for (const match of stripComments(source).matchAll(SPECIFIER)) {
    const specifier = match[2];
    if (specifier !== undefined) out.push(specifier);
  }
  return out;
}

let cached: ImportSite[] | undefined;

/** Every import statement in every package, comments stripped. */
export function importSites(): ImportSite[] {
  if (cached !== undefined) return cached;
  const sites: ImportSite[] = [];
  for (const dir of packageDirs()) {
    const source = `@kb/${dir}`;
    for (const file of sourceFilesUnder(join(PACKAGES_ROOT, dir))) {
      for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
        sites.push({ source, specifier, file: file.slice(PACKAGES_ROOT.length + 1) });
      }
    }
  }
  cached = sites;
  return sites;
}

/** Every `@kb/*` import that crosses a package boundary. */
export function importEdges(): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const { source, specifier, file } of importSites()) {
    if (!/^@kb\/[a-z0-9-]+$/.test(specifier) || specifier === source) continue;
    edges.push({ source, target: specifier, file });
  }
  return edges;
}
