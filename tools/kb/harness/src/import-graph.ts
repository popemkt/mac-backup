/**
 * Import-derived package edges.
 *
 * Measured on this workspace: `nx graph`'s dependency edges are
 * **manifest-derived only** — dropping `@kb/query` from @kb/operations'
 * package.json removed the edge even though every other file in that package
 * imports it, and adding an import without a manifest entry added no edge.
 * Nx's TypeScript locator needs `@nx/js`, which would drag a plugin stack in
 * for one job.
 *
 * So this scanner is the authority on edges. `boundaries` reads the manifests
 * directly for the edges packages *claim* — the same list Nx was returning —
 * and checks them against the scan, because a package that imports something
 * it does not declare only resolves by accident of hoisting. Nothing in the
 * harness spawns `nx graph` any more: tags no longer carry the layer, and the
 * project graph had nothing else to say.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "oxc-parser";
import { PACKAGES_ROOT, workspacePackages } from "./workspace.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", "storybook-static", ".nx"]);
const SOURCE_EXT = [".ts", ".tsx"];

/** A dynamic `import()` argument that is a plain quoted string. */
const QUOTED = /^(['"])(.*)\1$/s;

/** One import statement: the package it sits in, the raw specifier, the file. */
export interface ImportSite {
  /** Manifest name of the package the file belongs to. */
  source: string;
  specifier: string;
  /**
   * File that carries the import, relative to its own package (`src/…`).
   * Package-relative rather than packages-relative so no rule has to know how
   * deep a package sits — the owning package is already named by `source`.
   */
  file: string;
}

export interface ImportEdge {
  source: string;
  target: string;
  /** File that carries the import, relative to its own package. */
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

/**
 * Every module specifier one source file imports from, read off a parse.
 *
 * The regex this replaced keyed on the word `from`, so a side-effect
 * `import "@kb/x"` was invisible to it and `export * from "@kb/y"` only
 * matched by accident of that word. `oxc-parser`'s module record answers the
 * question directly: static imports, side-effect ones included; every
 * `export … from` specifier; and dynamic `import()` where the argument is a
 * literal. `require()` is absent from that record and does not need to be —
 * the workspace is ESM and no source calls it. Comments cannot produce an
 * entry either, so nothing strips them any more.
 */
export function specifiersOf(file: string, source: string): string[] {
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) {
    throw new Error(`${file}: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  const out: string[] = [];
  for (const entry of parsed.module.staticImports) {
    out.push(entry.moduleRequest.value);
  }
  for (const statement of parsed.module.staticExports) {
    for (const entry of statement.entries) {
      if (entry.moduleRequest !== null) out.push(entry.moduleRequest.value);
    }
  }
  for (const entry of parsed.module.dynamicImports) {
    const literal = QUOTED.exec(source.slice(entry.moduleRequest.start, entry.moduleRequest.end));
    if (literal?.[2] !== undefined) out.push(literal[2]);
  }
  return out;
}

/** One `export … from` statement: where it forwards from, and in what form. */
export interface ReExport {
  specifier: string;
  /** `export * from "x"` — a whole module under no name of its own. */
  star: boolean;
}

/**
 * Every `export … from` in one file. `export * from` and `export * as ns from`
 * differ by one token, and the whole `public-surface` rule turns on that
 * difference — the module record names it (`importName.kind`), a line pattern
 * has to re-derive it.
 */
export function reExportsOf(file: string, source: string): ReExport[] {
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) {
    throw new Error(`${file}: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  const out: ReExport[] = [];
  for (const statement of parsed.module.staticExports) {
    for (const entry of statement.entries) {
      if (entry.moduleRequest === null) continue;
      out.push({
        specifier: entry.moduleRequest.value,
        // Of the three forwarding forms, only `export * from` names nothing on
        // either side: `export * as ns from` names `ns`, `export { x } from`
        // names `x` twice.
        star: entry.importName.name === null && entry.exportName.name === null,
      });
    }
  }
  return out;
}

let cached: ImportSite[] | undefined;

/** Every import statement in every package. */
export function importSites(): ImportSite[] {
  if (cached !== undefined) return cached;
  const sites: ImportSite[] = [];
  for (const { dir, name } of workspacePackages()) {
    const root = join(PACKAGES_ROOT, dir);
    for (const file of sourceFilesUnder(root)) {
      for (const specifier of specifiersOf(file, readFileSync(file, "utf8"))) {
        sites.push({ source: name, specifier, file: file.slice(root.length + 1) });
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
