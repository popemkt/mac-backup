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
 * Red case: write `text-sm/6` or `rounded-3xl` in any component.
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
 * Candidates that are not classes, as `file: candidate`. The scanner reads
 * every token that could be a class; these are the ones that read like a
 * dead class but are something else. Keyed by file, so the same string
 * written as a class anywhere else is still checked.
 */
const NOT_CLASSES: ReadonlySet<string> = new Set([
  // tailwind-merge's theme key for the elevation names, not a class.
  "lib/cn.ts: shadow",
  // Prose in the Light study's description ("watch the soft shadow"), a word.
  "components/lab/studies.ts: shadow",
]);

/** Tailwind's own candidate extraction over each non-test UI module. */
function uiCandidatesByFile(): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const file of uiSourceFiles().filter((f) => !/\.test\.tsx?$/.test(f))) {
    const path = join(UI_ROOT, file);
    const content = withoutComments(path, readFileSync(path, "utf8"));
    const extension = file.endsWith(".tsx") ? "tsx" : "ts";
    // One scanner per file: a scanner reports each candidate only the first
    // time it sees it, which would attribute it to whichever file came first.
    byFile.set(file, new Scanner({}).scanFiles([{ content, extension }]));
  }
  return byFile;
}

async function emittedBy(css: string, candidates: string[]): Promise<Set<string>> {
  const design = await __unstable__loadDesignSystem(css, { base: UI_ROOT });
  const out = design.candidatesToCss(candidates);
  return new Set(candidates.filter((_, i) => out[i] !== null));
}

describe("ui-utilities-live", () => {
  test("every class candidate stock Tailwind compiles also compiles under index.css", async () => {
    const byFile = uiCandidatesByFile();
    const candidates = [...new Set([...byFile.values()].flat())];
    expect(candidates.length).toBeGreaterThan(500);

    const stock = await emittedBy('@import "tailwindcss";', candidates);
    const kb = await emittedBy(readFileSync(join(UI_ROOT, "index.css"), "utf8"), candidates);
    const dead = [...byFile]
      .flatMap(([file, found]) =>
        found.filter((c) => stock.has(c) && !kb.has(c)).map((c) => `${file}: ${c}`),
      )
      .filter((site) => !NOT_CLASSES.has(site))
      .toSorted();
    expect(dead).toEqual([]);
  }, 60_000);

  test("every NOT_CLASSES entry is still a scanned candidate (no stale exemptions)", () => {
    const byFile = uiCandidatesByFile();
    const stale = [...NOT_CLASSES].filter((site) => {
      const [file, candidate] = site.split(": ") as [string, string];
      return !(byFile.get(file) ?? []).includes(candidate);
    });
    expect(stale).toEqual([]);
  });
});
