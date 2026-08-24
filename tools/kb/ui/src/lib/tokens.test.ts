import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** DESIGN-RESKIN §1.2 pixel font-size whitelist for Tailwind text-[Npx] literals. */
const FONT_SIZE_WHITELIST = new Set([
  14.5, // node/field body
  13, // breadcrumb
  12, // section headers
  11, // tag chip
  10, // mono ids
  9, // bullet count badge
  20, // zoomed root title (§1.2 / §1.5)
]);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.(tsx?|css)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Declarations only — a rule about code must not be satisfied by prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("kb tokens", () => {
  const tokens = readFileSync(path.join(root, "tokens.css"), "utf8");
  const tokenDecls = stripComments(tokens);
  const index = readFileSync(path.join(root, "index.css"), "utf8");
  const content = readFileSync(
    path.join(root, "components/outline/node-content.tsx"),
    "utf8",
  );

  it("defines row metric tokens from DESIGN-REFINE W1", () => {
    expect(tokens).toMatch(/--kb-indent:\s*24px/);
    expect(tokens).toMatch(/--kb-row-h:\s*24px/);
    expect(tokens).toMatch(/--kb-text-size:\s*14\.5px/);
    expect(tokens).toMatch(/--kb-text-leading:\s*1\.6/);
    expect(tokens).toMatch(/--kb-field-label:\s*120px/);
  });

  it("tag typography is one token on .kb-tag/.kb-chip (i10 item 3)", () => {
    expect(tokens).toMatch(/\.kb-chip,\s*\n\s*\.kb-tag\s*\{/);
    expect(tokens).toMatch(/font-size:\s*var\(--tag-size\)/);
    expect(tokens).toMatch(/line-height:\s*var\(--tag-line\)/);
  });

  it("tag pill is sized from the line box, not a hardcoded chip height", () => {
    // Tana parity: the pill fills the line, so it is derived from the text
    // metric rather than re-stated as a magic px height per component.
    expect(tokens).toMatch(/--tag-h:\s*calc\(var\(--kb-text-line\)/);
    expect(tokens).toMatch(/--tag-line:\s*var\(--tag-h\)/);
    expect(tokens).toMatch(/\.kb-tag\s*\{[^}]*height:\s*var\(--tag-h\)/s);
    const chip = readFileSync(
      path.join(root, "components/outline/tag-chip.tsx"),
      "utf8",
    );
    expect(stripComments(chip)).not.toMatch(/h-\[\d+px\]/);
  });

  it("content row type scale is applied, not merely declared", () => {
    // The previous form was `font: var(--kb-text) inherit`, which reads as
    // tokenized but is invalid: a CSS-wide keyword cannot be a shorthand
    // component, so the declaration was dropped whole and .kb-text inherited
    // the 16px body size for its entire life. Longhands only.
    expect(tokens).toMatch(/\.kb-text\s*\{[^}]*font-size:\s*var\(--kb-text-size\)/s);
    expect(tokens).toMatch(
      /\.kb-text\s*\{[^}]*line-height:\s*var\(--kb-text-leading\)/s,
    );
    expect(tokenDecls).not.toMatch(/\bfont:\s*var\(/);
    expect(tokenDecls).not.toMatch(/\binherit\b/);
    expect(content).toMatch(/KB_TEXT_CLASS|kb-text/);
    expect(content).not.toMatch(/text-\[14\.5px\]/);
  });

  it("type-scale classes sit in the components layer so utilities still win", () => {
    // font-medium on a .kb-text heading must beat the token's 400, and
    // tokens.css is imported after Tailwind — without a layer it would not.
    expect(tokens).toMatch(/@layer\s+components\s*\{/);
    const layerStart = tokens.indexOf("@layer components");
    expect(layerStart).toBeGreaterThan(-1);
    expect(tokens.indexOf(".kb-text {")).toBeGreaterThan(layerStart);
  });

  it("index.css carries the nxus oklch palette (DESIGN-RESKIN §1.1)", () => {
    expect(index).toMatch(/:root\s*\{[^}]*--background:\s*oklch\(/s);
    expect(index).toMatch(/\.dark\s*\{[^}]*--background:\s*oklch\(/s);
    // Warm amber primary, light + dark
    expect(index).toContain("--primary: oklch(0.67 0.16 58)");
    expect(index).toContain("--primary: oklch(0.77 0.16 70)");
    expect(index).toMatch(/@custom-variant dark/);
    expect(index).toMatch(/data-scrolling/);
  });

  it("legacy skin is gone: no serif stack, gradients, or --kb palette bridges", () => {
    for (const css of [tokens, index]) {
      expect(css).not.toMatch(/radial-gradient/);
      expect(css).not.toMatch(/Iowan Old Style|Palatino|Georgia/);
      expect(css).not.toMatch(/--kb-bg|--kb-fg|--kb-accent|--kb-line/);
      expect(css).not.toMatch(/^\s*--bg:/m);
    }
  });

  it("font is a pref-driven CSS var (Inter Variable default, Outfit opt-in)", () => {
    expect(index).toMatch(/--app-font:\s*"Inter Variable"/);
    expect(index).toMatch(/html\[data-font="outfit"\]/);
    expect(index).toMatch(/--font-sans:\s*var\(--app-font\)/);
    expect(index).toMatch(/font-family:\s*"Inter Fallback"/);
    expect(index).toMatch(/@fontsource-variable\/inter/);
    expect(index).toMatch(/size-adjust:/);
  });

  it("tokens declare body weight for Inter (Outfit 500 read heavy)", () => {
    expect(tokens).toMatch(/--kb-text-weight:/);
    expect(tokens).toMatch(/--tag-weight:/);
    expect(index).toMatch(/--font-weight-body:\s*400/);
  });

  it("text-[Npx] literals in ui/src stay within §1.2 whitelist", () => {
    const srcRoot = path.join(root, "..");
    const offenders: string[] = [];
    const re = /text-\[(\d+(?:\.\d+)?)px\]/g;

    for (const file of collectSourceFiles(srcRoot)) {
      const rel = path.relative(srcRoot, file);
      if (rel.endsWith("tokens.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(re)) {
        const size = Number(match[1]);
        if (!FONT_SIZE_WHITELIST.has(size)) {
          offenders.push(`${rel}: text-[${match[1]}px]`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
