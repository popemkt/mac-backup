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
import { Scanner } from "@tailwindcss/oxide";
import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { oklchToRgb } from "./css-color";
import {
  baseSelector,
  darkSelector,
  readDesignSystemSheets,
  type Decls,
  type Variant,
} from "./design-system-sheets";
import {
  DEFAULT_DESIGN_SYSTEM,
  DESIGN_SYSTEMS,
  DESIGN_SYSTEM_IDS,
  type DesignSystemId,
} from "./theme";

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

/*
 * Text on the grounds the UI composes. A solid token pair says nothing about
 * `text-primary` on `bg-primary/10`, or a link inside a selected row that
 * paints `bg-primary/5` and then `bg-primary/8`: the ground there is a tint
 * composited over whatever surface it sits on. So the grounds are read from
 * the UI's own JSX, not declared. Each element's `className` literals are
 * split into classes by Tailwind's own `Scanner` (the one the build and the
 * liveness test use); a class names a colour through the `--color-*` bridge in
 * `index.css`, or through a component role in `tokens.css` that sets `color`.
 *
 * An element that holds text is a site. Its ground is its ancestors' and its
 * own `bg-*` layers, composited in sRGB — the way the browser paints them —
 * over each page surface. Classes under a condition (`a && "…"`, a ternary, a
 * `hover:` variant) are alternatives, each measured on its own; unconditional
 * ones always paint. Its text colour is its own `text-*` or the nearest
 * ancestor's, `--foreground` at a component's root.
 *
 * Out of reach of the walk, and so declared: a component's content mounted
 * into another component's element (MOUNTS). Out of the guard's scope:
 * translucent text (`text-foreground/40`), which is faint on purpose.
 * GAP [[01M3BEJDX4YP2DPHSCFS66NZK1]]
 */

const TOKENS_CSS = readFileSync(path.join(src, "tokens.css"), "utf8");
const INDEX_CSS = readFileSync(path.join(src, "index.css"), "utf8");

/** Tailwind colour name → layer-1 token, from the `@theme inline` bridge. */
const COLOR_TOKENS: ReadonlyMap<string, string> = new Map(
  [...INDEX_CSS.matchAll(/--color-([\w-]+):\s*var\((--[\w-]+)\)/g)].map((m) => [
    m[1] ?? "",
    m[2] ?? "",
  ]),
);

/** Component roles that set a text colour: class → token (`.kb-md-ref` → `--primary`). */
const ROLE_TEXT: ReadonlyMap<string, string> = new Map(
  [...TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
    (m) => {
      const token = /(?:^|;)\s*color:\s*var\((--[\w-]+)\)/.exec(m[2] ?? "")?.[1];
      if (token === undefined) return [];
      return (m[1] ?? "")
        .split(",")
        .map((s) => /^\s*\.([\w-]+)\s*$/.exec(s)?.[1])
        .filter((c) => c !== undefined)
        .map((c): [string, string] => [c, token]);
    },
  ),
);

/** The surfaces a tinted element can sit on. */
const SURFACES = ["--background", "--card", "--popover", "--sidebar"] as const;

/** A colour one class paints: a token and its alpha, and whether it always applies. */
interface Paint {
  readonly token: string;
  readonly alpha: number;
  readonly always: boolean;
}

/** What one element's classes paint. */
interface Layer {
  readonly grounds: readonly Paint[];
  readonly texts: readonly Paint[];
}

/** A place text is set: where, the text colours it may take, the layers under it. */
interface Site {
  readonly at: string;
  readonly texts: readonly Paint[];
  readonly chain: readonly Layer[];
}

function alphaOf(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  const arbitrary = /^\[([\d.]+)(%?)\]$/.exec(raw);
  if (arbitrary !== null) {
    const n = Number(arbitrary[1]);
    return arbitrary[2] === "%" ? n / 100 : n;
  }
  return /^\d+$/.test(raw) ? Number(raw) / 100 : null;
}

/** One class → the colour it paints as ground or text, if any. */
function paintOf(candidate: string, conditional: boolean): { ground?: Paint; text?: Paint } {
  const variants = candidate.split(":");
  const utility = variants.pop() ?? "";
  const always = !conditional && variants.length === 0;
  const role = ROLE_TEXT.get(utility);
  if (role !== undefined) return { text: { token: role, alpha: 1, always } };
  const m = /^(bg|text)-([\w-]+?)(?:\/(\[[\d.]+%?\]|\d+))?$/.exec(utility);
  const token = m === null ? undefined : COLOR_TOKENS.get(m[2] ?? "");
  const alpha = m === null ? null : alphaOf(m[3]);
  if (m === null || token === undefined || alpha === null) return {};
  const paint = { token, alpha, always };
  return m[1] === "bg" ? { ground: paint } : { text: paint };
}

type AstNode = { readonly type: string; readonly start: number } & Record<string, unknown>;
const isNode = (v: unknown): v is AstNode =>
  typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
const childrenOf = (node: AstNode): AstNode[] =>
  Object.entries(node).flatMap(([key, v]) =>
    key === "parent" ? [] : (Array.isArray(v) ? v : [v]).filter(isNode),
  );

/** The string literals under a `className` value, each with whether a condition guards it. */
function classLiterals(
  node: AstNode,
  conditional = false,
): { text: string; conditional: boolean }[] {
  if (node.type === "Literal" && typeof node["value"] === "string") {
    return [{ text: node["value"], conditional }];
  }
  if (node.type === "TemplateElement") {
    const cooked = (node["value"] as { cooked?: string } | undefined)?.cooked ?? "";
    return [{ text: cooked, conditional }];
  }
  const guards = node.type === "ConditionalExpression" || node.type === "LogicalExpression";
  return childrenOf(node).flatMap((child) =>
    classLiterals(
      child,
      conditional || (guards && child !== node["test"] && child !== node["left"]),
    ),
  );
}

function layerOf(element: AstNode): { layer: Layer; classes: readonly string[] } {
  const opening = element["openingElement"] as AstNode;
  const attr = (opening["attributes"] as unknown[])
    .filter(isNode)
    .find(
      (a) => a.type === "JSXAttribute" && (a["name"] as { name?: string }).name === "className",
    );
  const value = attr?.["value"];
  const grounds: Paint[] = [];
  const texts: Paint[] = [];
  const classes: string[] = [];
  for (const literal of isNode(value) ? classLiterals(value) : []) {
    const hits = new Scanner({}).getCandidatesWithPositions({
      content: literal.text,
      extension: "html",
    });
    for (const { candidate } of hits) {
      classes.push(candidate);
      const paint = paintOf(candidate, literal.conditional);
      if (paint.ground) grounds.push(paint.ground);
      if (paint.text) texts.push(paint.text);
    }
  }
  return { layer: { grounds, texts }, classes };
}

/** Whether an element holds text of its own (not only child elements). */
const holdsText = (element: AstNode): boolean =>
  (element["children"] as unknown[])
    .filter(isNode)
    .some(
      (c) =>
        (c.type === "JSXText" && String(c["value"]).trim() !== "") ||
        (c.type === "JSXExpressionContainer" &&
          isNode(c["expression"]) &&
          !["JSXEmptyExpression", "JSXElement", "JSXFragment"].includes(c["expression"].type)),
    );

/**
 * The text colours an element may take: the last one it always sets, else
 * the inherited ones, plus each one it sets under a condition.
 */
function textsOf(own: readonly Paint[], inherited: readonly Paint[]): readonly Paint[] {
  const fixed = own.findLast((p) => p.always);
  return [...(fixed === undefined ? inherited : [fixed]), ...own.filter((p) => !p.always)];
}

const ROOT_TEXT: readonly Paint[] = [{ token: "--foreground", alpha: 1, always: true }];

/** Every text site in one module, and every element's chain by class (for MOUNTS). */
function sitesIn(file: string, source: string) {
  const sites: Site[] = [];
  const hosts = new Map<string, readonly Layer[]>();
  const lineOf = (at: number) => source.slice(0, at).split("\n").length;
  const walk = (node: AstNode, chain: readonly Layer[], inherited: readonly Paint[]): void => {
    if (node.type !== "JSXElement") {
      for (const child of childrenOf(node)) walk(child, chain, inherited);
      return;
    }
    const { layer, classes } = layerOf(node);
    const own = [...chain, layer];
    const texts = textsOf(layer.texts, inherited);
    for (const c of classes) if (!hosts.has(c)) hosts.set(c, own);
    if (holdsText(node)) sites.push({ at: `${file}:${lineOf(node.start)}`, texts, chain: own });
    for (const child of childrenOf(node)) walk(child, own, texts);
  };
  walk(parseSync(file, source).program as unknown as AstNode, [], ROOT_TEXT);
  return { sites, hosts };
}

/**
 * Content one component mounts into another's element, which the per-module
 * walk cannot see: the guest module's sites are measured again under the
 * host element's chain. `at` is a class the host element carries.
 */
const MOUNTS: readonly { host: string; at: string; guest: string }[] = [
  // A row's content (NodeTextHost → MdView: text, refs, links) sits in the
  // row's `.node-content`, under a selected row's two primary tints.
  {
    host: "components/outline/node-row.tsx",
    at: "node-content",
    guest: "components/ui/md-view.tsx",
  },
];

function uiModules(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(src, { recursive: true })) {
    const file = String(entry);
    if (!file.endsWith(".tsx") || /\.(test|stories)\.tsx$/.test(file)) continue;
    out.set(file, readFileSync(path.join(src, file), "utf8"));
  }
  return out;
}

/** Every site, mounted ones included; a stale mount throws. */
function allSites(modules: ReadonlyMap<string, string>, mounts = MOUNTS): Site[] {
  const byFile = new Map([...modules].map(([file, source]) => [file, sitesIn(file, source)]));
  const mounted = mounts.flatMap(({ host, at, guest }) => {
    const hostChain = byFile.get(host)?.hosts.get(at);
    const guestSites = byFile.get(guest)?.sites;
    if (hostChain === undefined || guestSites === undefined || guestSites.length === 0) {
      throw new Error(`stale mount: ${guest} into ${host} .${at}`);
    }
    return guestSites.map((s) => ({
      ...s,
      at: `${s.at} in ${host}`,
      chain: [...hostChain, ...s.chain],
    }));
  });
  return [...[...byFile.values()].flatMap((f) => f.sites), ...mounted];
}

const over = (top: Rgb, alpha: number, under: Rgb): Rgb => [
  top[0] * alpha + under[0] * (1 - alpha),
  top[1] * alpha + under[1] * (1 - alpha),
  top[2] * alpha + under[2] * (1 - alpha),
];

/** Every ground a site's chain can paint over one surface, each with how it was made. */
function groundsOf(chain: readonly Layer[], surface: string, rgb: (t: string) => Rgb) {
  let grounds = [{ rgb: rgb(surface), how: surface }];
  for (const layer of chain) {
    const paint = (g: { rgb: Rgb; how: string }, p: Paint) => ({
      rgb: over(rgb(p.token), p.alpha, g.rgb),
      how: `${g.how} + ${p.token}${p.alpha < 1 ? `/${Math.round(p.alpha * 1000) / 10}%` : ""}`,
    });
    const based = grounds.map((g) => layer.grounds.filter((p) => p.always).reduce(paint, g));
    const next = [
      ...based,
      ...based.flatMap((g) => layer.grounds.filter((p) => !p.always).map((p) => paint(g, p))),
    ];
    grounds = [...new Map(next.map((g) => [g.rgb.map(Math.round).join(","), g])).values()];
  }
  return grounds;
}

/** Every opaque text on every ground it can land on, below AA, as `site: text on ground: ratio`. */
function tintFailures(sites: readonly Site[], id: DesignSystemId, variant: Variant): string[] {
  const cache = new Map<string, Rgb>();
  const rgb = (token: string) => {
    let hit = cache.get(token);
    if (hit === undefined) cache.set(token, (hit = rgbOf(SHEETS.resolve(id, variant, token))));
    return hit;
  };
  const failures = new Set<string>();
  for (const site of sites) {
    const texts = site.texts.filter((t) => t.alpha === 1);
    if (texts.length === 0 || site.chain.every((l) => l.grounds.length === 0)) continue;
    for (const surface of SURFACES) {
      for (const ground of groundsOf(site.chain, surface, rgb)) {
        for (const text of texts) {
          const ratio = contrast(rgb(text.token), ground.rgb);
          if (ratio < BODY)
            failures.add(`${site.at}: ${text.token} on ${ground.how}: ${ratio.toFixed(2)}`);
        }
      }
    }
  }
  return [...failures].toSorted();
}

describe("design systems: contrast on composited grounds (WCAG AA)", () => {
  const sites = allSites(uiModules());
  const cases = DESIGN_SYSTEM_IDS.flatMap((id) =>
    (["light", "dark"] as const).map((variant) => ({ id, variant })),
  );

  it("finds the UI's tinted text sites", () => {
    const tinted = sites.filter((s) => s.chain.some((l) => l.grounds.some((p) => p.alpha < 1)));
    expect(tinted.length).toBeGreaterThan(20);
  });

  it.each(cases)("$id/$variant text meets AA on every tint it sits on", ({ id, variant }) => {
    expect(tintFailures(sites, id, variant)).toEqual([]);
  });

  it("the red case: text under a guarded heavy tint fails, its unguarded state passes", () => {
    const fixture = new Map([
      [
        "chip.tsx",
        [
          'const a = <span className={cn("rounded", on && "bg-warning/60")}>',
          '  <i className="text-warning">!</i>',
          "</span>;",
        ].join("\n"),
      ],
    ]);
    const found = tintFailures(allSites(fixture, []), DEFAULT_DESIGN_SYSTEM, "light");
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.every((f) => f.startsWith("chip.tsx:2: --warning on --") && f.includes("/60%")),
    ).toBe(true);
  });

  it("the red case: a mounted role colour is measured on the host's stacked tints", () => {
    const fixture = new Map([
      [
        "row.tsx",
        '<div className="bg-primary/20"><div className="node-content bg-primary/20">{c}</div></div>;',
      ],
      ["md.tsx", '<a className="kb-md-ref">{label}</a>;'],
    ]);
    const mounts = [{ host: "row.tsx", at: "node-content", guest: "md.tsx" }];
    const found = tintFailures(allSites(fixture, mounts), DEFAULT_DESIGN_SYSTEM, "light");
    const stacked =
      "md.tsx:1 in row.tsx: --primary on --background + --primary/20% + --primary/20%:";
    expect(found.some((f) => f.startsWith(stacked))).toBe(true);
    expect(() => allSites(fixture, [{ host: "row.tsx", at: "gone", guest: "md.tsx" }])).toThrow(
      /stale mount/,
    );
  });
});
