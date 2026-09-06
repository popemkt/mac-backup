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
  UI_SPECIFIER_ALLOWS,
  UI_SRC,
  type UiZone,
  isUiTestFile,
  uiZoneOf,
} from "./constraints.ts";
import { sourceFilesUnder, specifiersOf } from "./import-graph.ts";
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
 * The line a specifier sits on, and the gap marker that line carries.
 *
 * Located by text rather than by parse span: the module record names the
 * specifier, and a quoted specifier appears on exactly the lines that import
 * it. The marker is read from that line, or from the line above when that line
 * is a comment of its own — a marker trailing the *previous* import belongs to
 * that import, not to this one. Repeated imports of one specifier share the
 * lines, which is why a sanctioned dependency is one gap and not one per line.
 */
function siteLines(lines: string[], specifier: string): Array<{ line: number; gap?: string }> {
  const quoted = `"${specifier}"`;
  const found: Array<{ line: number; gap?: string }> = [];
  for (const [index, text] of lines.entries()) {
    if (!text.includes(quoted)) continue;
    const above = lines[index - 1]?.trimStart() ?? "";
    const marker =
      GAP_MARKER.exec(text) ?? (above.startsWith("//") ? GAP_MARKER.exec(above) : null);
    found.push({ line: index + 1, ...(marker?.[1] === undefined ? {} : { gap: marker[1] }) });
  }
  return found;
}

let cached: UiImportSite[] | undefined;

/** Every import statement in the UI's `src/`, one entry per occurrence. */
export function uiImportSites(): UiImportSite[] {
  if (cached !== undefined) return cached;
  const sites: UiImportSite[] = [];
  for (const file of uiSourceFiles()) {
    const source = readFileSync(join(UI_SRC_ROOT, file), "utf8");
    const lines = source.split("\n");
    const zone = uiZoneOf(file);
    const seen = new Map<string, number>();
    for (const specifier of specifiersOf(join(UI_SRC_ROOT, file), source)) {
      const occurrences = siteLines(lines, specifier);
      const index = seen.get(specifier) ?? 0;
      seen.set(specifier, index + 1);
      const at = occurrences[Math.min(index, occurrences.length - 1)];
      const target = resolveWithin(file, specifier);
      sites.push({
        file,
        zone,
        specifier,
        line: at?.line ?? 0,
        target,
        targetZone: target === undefined ? undefined : uiZoneOf(target),
        gap: at?.gap,
      });
    }
  }
  cached = sites;
  return sites;
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

/** Where a UI file sits in the repository, for a message a reader can follow. */
export function uiRepoPath(file: string): string {
  return relative(WORKSPACE_ROOT, join(UI_SRC_ROOT, file));
}
