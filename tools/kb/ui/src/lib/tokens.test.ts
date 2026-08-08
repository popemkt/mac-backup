import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** DESIGN-RESKIN §1.2 pixel font-size whitelist for Tailwind text-[Npx] literals. */
const FONT_SIZE_WHITELIST = new Set([14.5, 13, 12, 11, 10, 9, 20]);

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

describe("kb tokens", () => {
  const tokens = readFileSync(path.join(root, "tokens.css"), "utf8");
  const index = readFileSync(path.join(root, "index.css"), "utf8");
  const content = readFileSync(
    path.join(root, "components/outline/node-content.tsx"),
    "utf8",
  );

  it("defines row metric tokens from DESIGN-REFINE W1", () => {
    expect(tokens).toMatch(/--kb-indent:\s*24px/);
    expect(tokens).toMatch(/--kb-row-h:\s*24px/);
    expect(tokens).toMatch(/--kb-text:\s*14\.5px\s*\/\s*1\.6/);
    expect(tokens).toMatch(/--kb-chip:\s*11px\s*\/\s*1\.8/);
    expect(tokens).toMatch(/--kb-field-label:\s*120px/);
  });

  it("content row uses var(--kb-text) via .kb-text", () => {
    expect(tokens).toMatch(/\.kb-text\s*\{[^}]*var\(--kb-text\)/s);
    expect(content).toMatch(/KB_TEXT_CLASS|kb-text/);
    expect(content).not.toMatch(/text-\[14\.5px\]/);
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

  it("font is a pref-driven CSS var (Outfit default, Inter opt-in)", () => {
    expect(index).toMatch(/--app-font:\s*"Outfit Variable"/);
    expect(index).toMatch(/html\[data-font="inter"\]/);
    expect(index).toMatch(/--font-sans:\s*var\(--app-font\)/);
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
