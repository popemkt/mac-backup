/**
 * The UI's intra-package import sites, resolved to zones.
 *
 * `import-graph.ts` answers "which package imports which" and drops everything
 * that does not cross a package boundary; inside `@kb/ui` that is every edge
 * the {@link UI_ALLOWS} matrix is about. This module reuses the same reader —
 * the same file walk, the same `oxc-parser` module record — and adds the one
 * thing the package graph has no use for: where a relative or `@/…` specifier
 * lands in the tree.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  UI_ALLOWS,
  UI_ENTRY,
  UI_LAZY_DEPTH,
  UI_LAZY_ONLY,
  UI_SPECIFIER_ALLOWS,
  UI_SRC,
  type UiZone,
  isUiTestFile,
  uiZoneOf,
} from "./constraints.ts";
import { type ImportKind, importsOf, sourceFilesUnder } from "./import-graph.ts";
import {
  PACKAGES_ROOT,
  WORKSPACE_ROOT,
  type WorkspacePackage,
  axisValues,
  tagsOf,
  workspacePackages,
} from "./workspace.ts";

const UI_SRC_ROOT = join(PACKAGES_ROOT, relative("packages", UI_SRC));

/** The extension-less forms a TypeScript specifier may stand for. */
const CANDIDATES = ["", ".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"];

/** `GAP [[id]]`, the marker grammar shared with `gap-markers-resolve`. */
const GAP_MARKER = /GAP \[\[([^\]]+)\]\]/;

/** One import inside the UI, with both ends placed in the zone matrix. */
export interface UiImportSite {
  /** File carrying the import, relative to {@link UI_SRC}. */
  file: string;
  zone: UiZone;
  specifier: string;
  /** Whether the import loads with the file, is erased, or loads lazily. */
  kind: ImportKind;
  /** 1-based line the specifier sits on. */
  line: number;
  /**
   * The imported file relative to {@link UI_SRC}, or `undefined` when the
   * specifier leaves the package (`@kb/*`, third party) or names a non-source
   * asset (`./index.css`) — neither is a zone edge.
   */
  target: string | undefined;
  targetZone: UiZone | undefined;
  /** The `GAP [[id]]` sanctioning this line, if it carries one. */
  gap: string | undefined;
}

/** Every `.ts`/`.tsx` file under the UI's `src/`, relative to it. */
export function uiSourceFiles(): string[] {
  return [...sourceFilesUnder(UI_SRC_ROOT)].map((file) => relative(UI_SRC_ROOT, file)).toSorted();
}

/** The source file a path names once TypeScript's extension-less forms are tried, if any. */
function sourceFileAt(base: string): string | undefined {
  for (const suffix of CANDIDATES) {
    const candidate = `${base}${suffix}`;
    if (!/\.tsx?$/.test(candidate)) continue;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** The source file a relative or `@/…` specifier names, if it is one. */
function resolveWithin(file: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith(".")) base = resolve(dirname(join(UI_SRC_ROOT, file)), specifier);
  else if (specifier.startsWith("@/")) base = join(UI_SRC_ROOT, specifier.slice(2));
  else return undefined;
  const found = sourceFileAt(base);
  return found === undefined ? undefined : relative(UI_SRC_ROOT, found);
}

/**
 * The 1-based line an offset falls on, and the gap marker that line carries:
 * on the line itself, or on the line above when that line is a comment of its
 * own — a marker trailing the *previous* import belongs to that import, not
 * to this one. The offset is the specifier's, from {@link importsOf}, so a
 * multi-line import is placed on the line that names its module.
 */
function siteAt(source: string, lines: readonly string[], offset: number) {
  const index = source.slice(0, offset).split("\n").length - 1;
  const text = lines[index] ?? "";
  const above = lines[index - 1]?.trimStart() ?? "";
  const marker = GAP_MARKER.exec(text) ?? (above.startsWith("//") ? GAP_MARKER.exec(above) : null);
  return { line: index + 1, gap: marker?.[1] };
}

let cached: UiImportSite[] | undefined;

/** Every import statement in the UI's `src/`, one entry per occurrence. */
export function uiImportSites(): UiImportSite[] {
  if (cached !== undefined) return cached;
  cached = uiSourceFiles().flatMap((file) =>
    uiImportSitesIn(file, readFileSync(join(UI_SRC_ROOT, file), "utf8")),
  );
  return cached;
}

/** The import sites of one UI file, given its path under `src/` and its text. */
export function uiImportSitesIn(file: string, source: string): UiImportSite[] {
  const lines = source.split("\n");
  const zone = uiZoneOf(file);
  return importsOf(join(UI_SRC_ROOT, file), source).map(({ specifier, kind, start }) => {
    const at = siteAt(source, lines, start);
    const target = resolveWithin(file, specifier);
    return {
      file,
      zone,
      specifier,
      kind,
      line: at.line,
      target,
      targetZone: target === undefined ? undefined : uiZoneOf(target),
      gap: at.gap,
    };
  });
}

/** How a site breaks the matrix, or `undefined` when it does not. */
function uiViolation(site: UiImportSite): string | undefined {
  const specifierZones = UI_SPECIFIER_ALLOWS[site.specifier];
  if (specifierZones !== undefined && !specifierZones.includes(site.zone)) {
    return `${site.zone} -> ${site.specifier} (only ${specifierZones.join(", ")} may)`;
  }
  if (site.targetZone === undefined || site.targetZone === site.zone) return undefined;
  if (isUiTestFile(site.file)) return undefined;
  if (UI_ALLOWS[site.zone].includes(site.targetZone)) return undefined;
  return `${site.zone} -> ${site.targetZone}`;
}

/** Every matrix breach in the UI, sanctioned ones included. */
export function uiViolations(): Array<UiImportSite & { violation: string }> {
  const out: Array<UiImportSite & { violation: string }> = [];
  for (const site of uiImportSites()) {
    const violation = uiViolation(site);
    if (violation !== undefined) out.push({ ...site, violation });
  }
  return out;
}

/**
 * One import in the page's bundle, placed by file. A `@kb/ui` file is keyed by
 * its path under {@link UI_SRC}, as in {@link UiImportSite}; a file of another
 * browser package by its package name and its path in the package
 * (`@kb/ui-sdk/src/index.ts`).
 */
export type BundleSite = Pick<UiImportSite, "file" | "specifier" | "kind" | "target">;

/** The package `@kb/ui`'s `src` belongs to. */
const UI_PACKAGE = "@kb/ui";

/**
 * The page's other packages: every `scope:browser` workspace package but
 * `@kb/ui` itself. The shell's Vite build compiles each from source into the
 * one bundle (DESIGN-UI.md → Extension UI halves).
 */
function browserPackages(): WorkspacePackage[] {
  return workspacePackages().filter(
    (pkg) => pkg.name !== UI_PACKAGE && axisValues(tagsOf(pkg.manifest), "scope")[0] === "browser",
  );
}

/** The key of a browser package's file in the bundle. */
function packageKey(pkg: WorkspacePackage, path: string): string {
  return `${pkg.name}/${relative(join(PACKAGES_ROOT, pkg.dir), path)}`;
}

/**
 * Every source file of the page: `@kb/ui`'s, keyed as {@link uiSourceFiles}
 * keys them, then each other browser package's, keyed by package.
 */
export function bundleSourceFiles(): Array<{ readonly key: string; readonly path: string }> {
  return [
    ...uiSourceFiles().map((file) => ({ key: file, path: join(UI_SRC_ROOT, file) })),
    ...browserPackages().flatMap((pkg) =>
      [...sourceFilesUnder(join(PACKAGES_ROOT, pkg.dir))]
        .toSorted()
        .map((path) => ({ key: packageKey(pkg, path), path })),
    ),
  ];
}

let cachedBundle: BundleSite[] | undefined;

/**
 * Every import of the page's bundle. A `@kb/<browser package>` specifier lands
 * on that package's barrel, from `@kb/ui` or from another browser package, so
 * a path from the entry walks into the kit and the families' UI halves exactly
 * as Vite does. Any other package is not part of the walk: its imports are not
 * compiled into the bundle from this tree.
 */
export function bundleImportSites(): BundleSite[] {
  if (cachedBundle !== undefined) return cachedBundle;
  const packages = browserPackages();
  const barrels = new Map(
    packages.map((pkg) => [
      pkg.name,
      packageKey(pkg, join(PACKAGES_ROOT, pkg.dir, "src/index.ts")),
    ]),
  );
  const ui = uiImportSites().map((site) => ({
    ...site,
    target: site.target ?? barrels.get(site.specifier),
  }));
  const rest = packages.flatMap((pkg) =>
    [...sourceFilesUnder(join(PACKAGES_ROOT, pkg.dir))].flatMap((path) =>
      importsOf(path, readFileSync(path, "utf8")).map(({ specifier, kind }) => {
        const local = specifier.startsWith(".")
          ? sourceFileAt(resolve(dirname(path), specifier))
          : undefined;
        return {
          file: packageKey(pkg, path),
          specifier,
          kind,
          target: local === undefined ? barrels.get(specifier) : packageKey(pkg, local),
        };
      }),
    ),
  );
  cachedBundle = [...ui, ...rest];
  return cachedBundle;
}

/**
 * The fewest dynamic imports any path from `entry` crosses to reach each
 * file, with the path that does it (`a => b` for a lazy edge). Type-only
 * edges load nothing and are not paths.
 */
export function lazyDepths(
  sites: readonly BundleSite[],
  entry: string = UI_ENTRY,
): Map<string, { depth: number; chain: readonly string[] }> {
  const edges = new Map<string, Array<{ to: string; lazy: boolean }>>();
  for (const site of sites) {
    if (site.kind === "type" || site.target === undefined) continue;
    const from = edges.get(site.file) ?? [];
    from.push({ to: site.target, lazy: site.kind === "lazy" });
    edges.set(site.file, from);
  }
  // 0-1 breadth-first: an eager edge costs nothing, a lazy one costs one.
  const best = new Map<string, { depth: number; chain: readonly string[] }>([
    [entry, { depth: 0, chain: [entry] }],
  ]);
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const here = best.get(file);
    if (here === undefined) continue;
    for (const { to, lazy } of edges.get(file) ?? []) {
      const depth = here.depth + (lazy ? 1 : 0);
      const known = best.get(to);
      if (known !== undefined && known.depth <= depth) continue;
      best.set(to, { depth, chain: [...here.chain, `${lazy ? "=>" : "->"} ${to}`] });
      if (lazy) queue.push(to);
      else queue.unshift(to);
    }
  }
  return best;
}

/**
 * Each import of a {@link UI_LAZY_ONLY} specifier issued from a file some
 * path from the entry reaches across fewer than {@link UI_LAZY_DEPTH}
 * dynamic imports, printed as that path (`=>` marks a lazy edge). Eager or
 * lazy alike: a top-level `import("three")` in a route chunk fetches three
 * on every visit to the surface, so it too must sit behind the 3D view's own
 * boundary. A type-only import loads nothing.
 */
export function lazyFenceBreaches(
  sites: readonly BundleSite[],
  entry: string = UI_ENTRY,
): string[] {
  const depths = lazyDepths(sites, entry);
  const out: string[] = [];
  for (const site of sites) {
    if (site.kind === "type" || !UI_LAZY_ONLY.test(site.specifier)) continue;
    const reached = depths.get(site.file);
    if (reached === undefined || reached.depth >= UI_LAZY_DEPTH) continue;
    out.push(`${reached.chain.join(" ")} ${site.kind === "lazy" ? "=>" : "->"} ${site.specifier}`);
  }
  return out.toSorted();
}

/** Where a UI file sits in the repository, for a message a reader can follow. */
export function uiRepoPath(file: string): string {
  return relative(WORKSPACE_ROOT, join(UI_SRC_ROOT, file));
}
