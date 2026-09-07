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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { parseSync } from "oxc-parser";
import { PACKAGES_ROOT, readTsconfig, workspacePackages } from "./workspace.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", "storybook-static", ".nx"]);

/**
 * Every JavaScript-family source extension, not the two the workspace happens
 * to be written in today. An extension this list omits is a file the whole
 * fence cannot see: a `.mts` module importing across a layer would satisfy
 * `boundaries` by virtue of its name. `oxc-parser` picks its dialect off the
 * filename, and a file it cannot parse throws rather than reporting no
 * imports, so a JSX body in a bare `.js` fails loudly instead of quietly.
 */
const SOURCE_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

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

/** Every {@link SOURCE_EXT} file under a directory, derived output skipped. */
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

let cachedSites: ImportSite[] | undefined;

/** Every import statement in every package. */
export function importSites(packagesRoot: string = PACKAGES_ROOT): ImportSite[] {
  if (packagesRoot === PACKAGES_ROOT && cachedSites !== undefined) return cachedSites;
  const sites: ImportSite[] = [];
  for (const { dir, name } of workspacePackages(packagesRoot)) {
    const root = join(packagesRoot, dir);
    for (const file of sourceFilesUnder(root)) {
      for (const specifier of specifiersOf(file, readFileSync(file, "utf8"))) {
        sites.push({ source: name, specifier, file: file.slice(root.length + 1) });
      }
    }
  }
  if (packagesRoot === PACKAGES_ROOT) cachedSites = sites;
  return sites;
}

/**
 * A workspace member as the resolver needs it: where it sits, what it is
 * called, and the intra-package spellings its own tsconfig gives its sources.
 */
interface PackageRoot {
  /** Path under `packages/`, `<layer>/<name>`. */
  dir: string;
  /** Manifest name. */
  name: string;
  /**
   * `compilerOptions.paths`, as [prefix, target] pairs — `["@/", "src/"]` —
   * with the target relative to {@link dir}. An alias is a second spelling of
   * a relative import, so the resolver expands it and asks the same question
   * of the result. Without that, `@/lib/x` reads as a third-party specifier
   * and an alias retargeted at another package is an edge nothing sees.
   */
  aliases: ReadonlyArray<readonly [string, string]>;
}

/** The `paths` one package's own tsconfig declares, as prefix/target pairs. */
function aliasesOf(dir: string, packagesRoot: string): Array<readonly [string, string]> {
  const config = join(packagesRoot, dir, "tsconfig.json");
  if (!existsSync(config)) return [];
  const paths = readTsconfig(config).compilerOptions?.["paths"];
  if (typeof paths !== "object" || paths === null) return [];
  const out: Array<readonly [string, string]> = [];
  for (const [pattern, targets] of Object.entries(paths as Record<string, unknown>)) {
    if (!Array.isArray(targets)) continue;
    const target = targets[0];
    if (typeof pattern !== "string" || typeof target !== "string") continue;
    if (!pattern.endsWith("*") || !target.endsWith("*")) continue;
    out.push([pattern.slice(0, -1), target.slice(0, -1)]);
  }
  return out;
}

function packageRoots(packagesRoot: string = PACKAGES_ROOT): PackageRoot[] {
  return workspacePackages(packagesRoot).map(({ dir, name }) => ({
    dir,
    name,
    aliases: aliasesOf(dir, packagesRoot),
  }));
}

/**
 * How a specifier names the package it reaches.
 *
 * Only `entry` is sanctioned. The other two reach the same code by a name the
 * target never published: `subpath` walks past the barrel `public-surface`
 * curates, `relative` does not name the target package at all — and either way
 * no manifest records the dependency, so it resolves by accident of hoisting.
 */
type ImportForm = "entry" | "subpath" | "relative";

/** Where one specifier points, once resolved against the file that wrote it. */
type ImportTarget =
  /** Inside the importing package — its own name, a relative path, an alias. */
  | { kind: "internal" }
  /** A module outside the workspace: npm, `node:`, `bun:`. */
  | { kind: "third-party" }
  /** Another workspace package, reached by `form`. */
  | { kind: "workspace"; target: string; form: ImportForm }
  /** A relative path that lands under no package at all. */
  | { kind: "escape"; path: string };

export interface ResolvedImport extends ImportSite {
  target: ImportTarget;
}

const KB_SPECIFIER = /^(@kb\/[a-z0-9-]+)(\/.+)?$/;

/** Owner of a packages-root-relative path: the longest package dir prefix. */
function ownerOf(packages: readonly PackageRoot[], path: string): PackageRoot | undefined {
  let owner: PackageRoot | undefined;
  for (const pkg of packages) {
    if (path !== pkg.dir && !path.startsWith(`${pkg.dir}/`)) continue;
    if (owner === undefined || pkg.dir.length > owner.dir.length) owner = pkg;
  }
  return owner;
}

/**
 * The one place a specifier becomes a package. Every fence downstream reads
 * its answer, so a spelling this function does not resolve is a spelling the
 * fences cannot see — which is why the two bypasses it used to drop
 * (`@kb/<pkg>/<subpath>` and a relative path out of the package directory) are
 * resolved here rather than filtered out.
 *
 * Paths are POSIX throughout: `file` arrives package-relative from
 * {@link importSites}, and the result is compared against `dir`, which
 * {@link packageDirs} writes with forward slashes.
 */
function resolveImport(packages: readonly PackageRoot[], site: ImportSite): ImportTarget {
  const self = packages.find((pkg) => pkg.name === site.source);
  if (self === undefined) throw new Error(`${site.source}: not a workspace package`);

  const kb = KB_SPECIFIER.exec(site.specifier);
  if (kb !== null) {
    const [, name, subpath] = kb;
    if (name === undefined || name === site.source) return { kind: "internal" };
    return { kind: "workspace", target: name, form: subpath === undefined ? "entry" : "subpath" };
  }

  // An alias target is package-relative; a relative specifier is relative to
  // the importing file. Both end up as one path under `packages/`.
  const alias = self.aliases.find(([prefix]) => site.specifier.startsWith(prefix));
  let path: string;
  if (alias !== undefined) {
    path = posix.normalize(posix.join(self.dir, alias[1], site.specifier.slice(alias[0].length)));
  } else if (site.specifier.startsWith(".")) {
    path = posix.normalize(posix.join(self.dir, posix.dirname(site.file), site.specifier));
  } else {
    return { kind: "third-party" };
  }

  const owner = ownerOf(packages, path);
  if (owner === undefined) return { kind: "escape", path };
  if (owner.name === self.name) return { kind: "internal" };
  return { kind: "workspace", target: owner.name, form: "relative" };
}

let cachedResolved: ResolvedImport[] | undefined;

/** Every import site with its target resolved: the graph, in one pass. */
export function resolvedImports(packagesRoot: string = PACKAGES_ROOT): ResolvedImport[] {
  if (packagesRoot === PACKAGES_ROOT && cachedResolved !== undefined) return cachedResolved;
  const packages = packageRoots(packagesRoot);
  const resolved = importSites(packagesRoot).map((site) => ({
    ...site,
    target: resolveImport(packages, site),
  }));
  if (packagesRoot === PACKAGES_ROOT) cachedResolved = resolved;
  return resolved;
}

/** Every import that crosses a package boundary, however it is spelled. */
export function importEdges(packagesRoot: string = PACKAGES_ROOT): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const { source, file, target } of resolvedImports(packagesRoot)) {
    if (target.kind === "workspace") edges.push({ source, target: target.target, file });
  }
  return edges;
}

/**
 * Why one import is a breach of the target's public surface, or `undefined`.
 *
 * Stated here rather than in the check that reports it, because
 * {@link resolveImport} is what knows the forms and this is the sentence that
 * says which of them are allowed: the bare package name, and nothing else.
 */
export function surfaceBypass(imp: ResolvedImport): string | undefined {
  if (imp.target.kind === "escape") {
    return `${imp.source} imports "${imp.specifier}", which resolves to ${imp.target.path}, under no package  [${imp.file}]`;
  }
  if (imp.target.kind !== "workspace" || imp.target.form === "entry") return undefined;
  const past =
    imp.target.form === "subpath"
      ? `past ${imp.target.target}'s barrel`
      : `${imp.target.target} without naming it`;
  return `${imp.source} imports "${imp.specifier}", reaching ${past}  [${imp.file}]`;
}
