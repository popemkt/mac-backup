/**
 * Guards for the design systems (DESIGN-UI.md → Design tokens → Design
 * systems): the registry and the stylesheets name the same systems, every
 * system is complete against the default, and every system's text meets
 * WCAG AA against the ground it sits on — computed from the oklch values in
 * the CSS itself, not from a copy.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { oklchToRgb } from "./css-color";
import {
  baseSelector,
  darkSelector,
  readDesignSystemSheets,
  type Decls,
} from "./design-system-sheets";
import { DEFAULT_DESIGN_SYSTEM, DESIGN_SYSTEMS, DESIGN_SYSTEM_IDS } from "./theme";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const systemsDir = path.join(src, "design-systems");
const SHEETS = readDesignSystemSheets(
  readFileSync(path.join(src, "design-system.css"), "utf8"),
  (id) => readFileSync(path.join(systemsDir, `${id}.css`), "utf8"),
);
const DEFAULT = SHEETS.default;
const OTHERS = DESIGN_SYSTEM_IDS.filter((id) => id !== DEFAULT_DESIGN_SYSTEM);

/**
 * The inheritance rule. A system restates every token the default sets, in
 * every variant the default sets it, except:
 *  - shared tokens: the JSON Canvas presets are document colours — a card
 *    saved as "red" is red in every skin — so no system may set them;
 *  - derived tokens: a default value that is only a reference to another
 *    token (`--lab-accent: var(--primary)`) follows that token, so a system
 *    inherits it unless it restates it on purpose.
 */
const isShared = (token: string) => token.startsWith("--canvas-color-");
const isDerived = (token: string) => /^var\(--[\w-]+\)$/.test(DEFAULT.base.get(token) ?? "");

describe("design systems: registry and stylesheets", () => {
  it("lists the default first, once, with a label for every id", () => {
    expect(DESIGN_SYSTEM_IDS[0]).toBe(DEFAULT_DESIGN_SYSTEM);
    expect(new Set(DESIGN_SYSTEM_IDS).size).toBe(DESIGN_SYSTEM_IDS.length);
    expect(DESIGN_SYSTEMS.map((s) => s.id)).toEqual([...DESIGN_SYSTEM_IDS]);
    for (const s of DESIGN_SYSTEMS) expect(s.label.length).toBeGreaterThan(0);
  });

  it("has one stylesheet per non-default id, and none without an id", () => {
    const files = readdirSync(systemsDir)
      .filter((f) => f.endsWith(".css"))
      .map((f) => f.replace(/\.css$/, ""))
      .toSorted();
    expect(files).toEqual([...OTHERS].toSorted());
  });

  it("imports every stylesheet after the default and before the roles", () => {
    const index = readFileSync(path.join(src, "index.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const at = (spec: string) => index.indexOf(`@import "${spec}";`);
    const defaultAt = at("./design-system.css");
    const rolesAt = at("./tokens.css");
    for (const id of OTHERS) {
      expect(at(`./design-systems/${id}.css`)).toBeGreaterThan(defaultAt);
      expect(at(`./design-systems/${id}.css`)).toBeLessThan(rolesAt);
    }
  });

  it.each(OTHERS)("%s is exactly a base block and a dark block under its own id", (id) => {
    const system = SHEETS.systems.get(id);
    expect(system?.blocks.map((b) => b.selector)).toEqual([baseSelector(id), darkSelector(id)]);
  });
});

describe("design systems: completeness against the default", () => {
  it.each(OTHERS)("%s restates every non-shared, non-derived token in each variant", (id) => {
    const system = SHEETS.systems.get(id);
    if (system === undefined) throw new Error(id);
    const missing = (defaults: Decls, own: Decls) =>
      [...defaults.keys()].filter((t) => !isShared(t) && !isDerived(t) && !own.has(t));
    expect(missing(DEFAULT.base, system.base)).toEqual([]);
    // A token the default varies in dark and a system sets only in its base
    // block would paint that base (light) value in dark.
    expect(missing(DEFAULT.dark, system.dark)).toEqual([]);
  });

  it.each(OTHERS)("%s sets no shared and no unknown token", (id) => {
    const system = SHEETS.systems.get(id);
    if (system === undefined) throw new Error(id);
    for (const own of [system.base, system.dark]) {
      const stray = [...own.keys()].filter((t) => isShared(t) || !DEFAULT.base.has(t));
      expect(stray).toEqual([]);
    }
  });
});

/** An opaque sRGB colour, 0–255 per channel, as the browser paints it. */
type Rgb = readonly [r: number, g: number, b: number];

function rgbOf(color: string): Rgb {
  const rgb = oklchToRgb(color);
  if (rgb === null) throw new Error(`not an oklch colour: ${color}`);
  if (rgb.alpha < 1) throw new Error(`translucent colour in a contrast pair: ${color}`);
  return [rgb.r, rgb.g, rgb.b];
}

/** sRGB byte → linear light (WCAG 2 relative luminance). */
function linear(byte: number): number {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/**
 * Text and the ground it is set on, each held to WCAG AA for body text,
 * 4.5:1. Every pair here is body-sized text somewhere — the accent colours
 * reference links (`.kb-md-ref`), the warning colour inline notices
 * (`text-warning`) — so none is graded at the 3:1 large-text/UI floor.
 */
const BODY = 4.5;
const PAIRS: readonly (readonly [text: string, ground: string])[] = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--muted"],
  ["--primary-foreground", "--primary"],
  ["--primary", "--background"],
  ["--destructive", "--background"],
  ["--warning", "--background"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-accent-foreground", "--sidebar-accent"],
  ["--sidebar-primary-foreground", "--sidebar-primary"],
  ["--lab-ink", "--lab-ground"],
];

describe("design systems: contrast (WCAG AA)", () => {
  const cases = DESIGN_SYSTEM_IDS.flatMap((id) =>
    (["light", "dark"] as const).map((variant) => ({ id, variant })),
  );
  it.each(cases)("$id/$variant text meets AA on its ground", ({ id, variant }) => {
    const value = (token: string) => rgbOf(SHEETS.resolve(id, variant, token));
    const failures = PAIRS.map(([text, ground]) => ({
      name: `${id}/${variant} ${text} on ${ground}`,
      ratio: contrast(value(text), value(ground)),
    }))
      .filter(({ ratio }) => ratio < BODY)
      .map(({ name, ratio }) => `${name}: ${ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });
});
