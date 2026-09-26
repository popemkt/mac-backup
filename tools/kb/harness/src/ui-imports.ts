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
import { PACKAGES_ROOT, WORKSPACE_ROOT } from "./workspace.ts";

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

/** The source file a relative or `@/…` specifier names, if it is one. */
function resolveWithin(file: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith(".")) base = resolve(dirname(join(UI_SRC_ROOT, file)), specifier);
  else if (specifier.startsWith("@/")) base = join(UI_SRC_ROOT, specifier.slice(2));
  else return undefined;
  for (const suffix of CANDIDATES) {
    const candidate = `${base}${suffix}`;
    if (!/\.tsx?$/.test(candidate)) continue;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(UI_SRC_ROOT, candidate);
    }
  }
  return undefined;
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
 * The fewest dynamic imports any path from `entry` crosses to reach each
 * file, with the path that does it (`a => b` for a lazy edge). Type-only
 * edges load nothing and are not paths.
 */
export function lazyDepths(
  sites: readonly UiImportSite[],
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
  sites: readonly UiImportSite[],
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
