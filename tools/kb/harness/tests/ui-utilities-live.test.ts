import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { parseSync } from "oxc-parser";
import { UI_SRC } from "../src/constraints.ts";
import { uiSourceFiles } from "../src/ui-imports.ts";
import { WORKSPACE_ROOT } from "../src/workspace.ts";

/**
 * Every utility the UI writes emits CSS (DESIGN-UI.md → Design tokens →
 * Enforcement, "liveness").
 *
 * The token bridge resets Tailwind's own text, shadow and radius scales, so a
 * default step such as `text-sm/6` or `rounded-3xl` still reads like a class
 * but compiles to nothing: the element silently loses its style. Which
 * utilities exist is a question only Tailwind can answer, so this asks it.
 * Tailwind's own `Scanner` (the one the build uses) extracts the candidates
 * from the UI source, and each is compiled twice — against stock Tailwind
 * and against `index.css`. A candidate stock Tailwind turns into CSS and kb's
 * stylesheet does not is dead in kb.
 *
 * Comparing against stock Tailwind is what separates a dead utility from
 * the scanner's ordinary noise (identifiers, words in strings), which emits
 * nothing under either. Comments are blanked first, so prose that happens to
 * read as a class ("a rounded polygon") is not a candidate. Test files are
 * not scanned: they assert on markup, they do not style it. Whether a live
 * utility bypasses the design system is a different question, owned by the
 * `design-tokens/no-raw-design-value` lint rule.
 *
 * Red case: write `text-sm/6` or `rounded-3xl` in any component (the
 * fixture test below pins it).
 */

const UI_ROOT = join(WORKSPACE_ROOT, UI_SRC);

/** A module's source with every comment replaced by spaces of equal length. */
function withoutComments(file: string, source: string): string {
  let out = source;
  for (const comment of parseSync(file, source).comments) {
    out =
      out.slice(0, comment.start) +
      " ".repeat(comment.end - comment.start) +
      out.slice(comment.end);
  }
  return out;
}

/**
 * Occurrences that are not classes. The scanner reads every token that could
 * be a class; these read like a dead class but are something else. Each
 * exempts one occurrence: `candidate` where it sits inside `context`, an
 * exact snippet of `file`. The same string written as a class anywhere else,
 * in the same file included, is still checked; an entry whose snippet no
 * longer holds its candidate is stale and fails.
 */
interface NotAClass {
  readonly file: string;
  readonly candidate: string;
  readonly context: string;
}

const NOT_CLASSES: readonly NotAClass[] = [
  // tailwind-merge's theme key for the elevation names.
  { file: "lib/cn.ts", candidate: "shadow", context: "shadow: [...ELEVATIONS]" },
  // Prose in the Light study's description.
  { file: "components/lab/studies.ts", candidate: "shadow", context: "watch the soft shadow and" },
];

/** A scanned occurrence: which file, which 1-based line, which candidate. */
interface Occurrence {
  readonly file: string;
  readonly line: number;
  readonly offset: number;
  readonly candidate: string;
}

/** Tailwind's own candidate extraction, with each occurrence's position. */
function occurrencesIn(file: string, content: string): Occurrence[] {
  const extension = file.endsWith(".tsx") ? "tsx" : "ts";
  // One scanner per file. A position is a string index into `content`
  // (`content.slice(position)` starts with the candidate), so it is the
  // offset as is; the non-ASCII fixture below pins that.
  return new Scanner({}).getCandidatesWithPositions({ content, extension }).map((hit) => ({
    file,
    offset: hit.position,
    line: content.slice(0, hit.position).split("\n").length,
    candidate: hit.candidate,
  }));
}

/** Whether an exemption covers this occurrence of its candidate in `content`. */
function exempts(entry: NotAClass, hit: Occurrence, content: string): boolean {
  if (entry.file !== hit.file || entry.candidate !== hit.candidate) return false;
  for (
    let at = content.indexOf(entry.context);
    at !== -1;
    at = content.indexOf(entry.context, at + 1)
  ) {
    if (hit.offset >= at && hit.offset + hit.candidate.length <= at + entry.context.length) {
      return true;
    }
  }
  return false;
}

async function emittedBy(css: string, candidates: string[]): Promise<Set<string>> {
  const design = await __unstable__loadDesignSystem(css, { base: UI_ROOT });
  const out = design.candidatesToCss(candidates);
  return new Set(candidates.filter((_, i) => out[i] !== null));
}

/**
 * Every occurrence, in these sources, of a candidate stock Tailwind compiles
 * and `index.css` does not, minus the exemptions — as `file:line: candidate`.
 */
async function deadSites(
  sources: ReadonlyMap<string, string>,
  notClasses: readonly NotAClass[],
): Promise<string[]> {
  const hits = [...sources].flatMap(([file, content]) => occurrencesIn(file, content));
  const candidates = [...new Set(hits.map((hit) => hit.candidate))];
  const stock = await emittedBy('@import "tailwindcss";', candidates);
  const kb = await emittedBy(readFileSync(join(UI_ROOT, "index.css"), "utf8"), candidates);
  return hits
    .filter((hit) => stock.has(hit.candidate) && !kb.has(hit.candidate))
    .filter((hit) => !notClasses.some((e) => exempts(e, hit, sources.get(hit.file) ?? "")))
    .map((hit) => `${hit.file}:${hit.line}: ${hit.candidate}`)
    .toSorted();
}

/** The UI's non-test modules, comments blanked, keyed by path under src. */
function uiSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of uiSourceFiles().filter((f) => !/\.test\.tsx?$/.test(f))) {
    const path = join(UI_ROOT, file);
    sources.set(file, withoutComments(path, readFileSync(path, "utf8")));
  }
  return sources;
}

describe("ui-utilities-live", () => {
  test("every class candidate stock Tailwind compiles also compiles under index.css", async () => {
    const sources = uiSources();
    expect(sources.size).toBeGreaterThan(100);
    expect(await deadSites(sources, NOT_CLASSES)).toEqual([]);
  }, 60_000);

  test("the red case: a reset default step is dead, a design-system step is not", async () => {
    // Locks the comparison itself in: were candidatesToCss null (or a string)
    // for everything, the empty list above would pass for the wrong reason.
    const fixture = new Map([["components/fixture.tsx", 'const c = "rounded-md text-sm/6";']]);
    expect(await deadSites(fixture, [])).toEqual(["components/fixture.tsx:1: text-sm/6"]);
  });

  test("an exemption covers its occurrence only, not the file", async () => {
    const content = 'const t = { shadow: [...ELEVATIONS] };\nconst c = "shadow";';
    const fixture = new Map([["lib/cn.ts", content]]);
    expect(await deadSites(fixture, NOT_CLASSES)).toEqual(["lib/cn.ts:2: shadow"]);
  });

  test("positions are exact after non-ASCII text: lines and exemptions hold", async () => {
    // "é" is two UTF-8 bytes and "—" three; read as byte offsets, every hit
    // after them would land early and the exemption's span check would miss.
    const content = [
      'const note = "café — naïve";',
      "const t = { shadow: [...ELEVATIONS] };",
      'const a = "é";',
      'const c = "shadow";',
      'const d = "— text-sm/6";',
    ].join("\n");
    for (const hit of occurrencesIn("lib/cn.ts", content)) {
      expect(content.slice(hit.offset, hit.offset + hit.candidate.length)).toBe(hit.candidate);
    }
    const fixture = new Map([["lib/cn.ts", content]]);
    expect(await deadSites(fixture, NOT_CLASSES)).toEqual([
      "lib/cn.ts:4: shadow",
      "lib/cn.ts:5: text-sm/6",
    ]);
  });

  test("every NOT_CLASSES entry still covers an occurrence (no stale exemptions)", () => {
    const sources = uiSources();
    const stale = NOT_CLASSES.filter((entry) => {
      const content = sources.get(entry.file) ?? "";
      return !occurrencesIn(entry.file, content).some((hit) => exempts(entry, hit, content));
    });
    expect(stale).toEqual([]);
  });
});
