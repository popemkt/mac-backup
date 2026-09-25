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
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { parseSync } from "oxc-parser";
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

/*
 * Text on the grounds the UI composes. A solid token pair says nothing about
 * `text-primary` on `bg-primary/10`, or a link inside a selected row that
 * paints `bg-primary/5` and then `bg-primary/8`: the ground there is a tint
 * composited over whatever surface it sits on. So the grounds are read from
 * the UI's own JSX, not declared. Each element's `className` literals are
 * split into classes by Tailwind's own `Scanner` (the one the build and the
 * liveness test use), and what each paints is what Tailwind compiles it to
 * against `index.css`, or a component role in `tokens.css` that sets `color`.
 * A colour class that paints no design-system token fails: it cannot be
 * measured, and no design system re-colours it.
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

/** Tailwind compiled against `index.css`: the authority on what a utility paints. */
const TAILWIND = await __unstable__loadDesignSystem(
  readFileSync(path.join(src, "index.css"), "utf8"),
  { base: src },
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

/** What one element's classes paint, and its colour classes that name no token. */
interface Layer {
  readonly grounds: readonly Paint[];
  readonly texts: readonly Paint[];
  readonly unresolved: readonly string[];
}

/** A place text is set: where, the text colours it may take, the layers under it. */
interface Site {
  readonly at: string;
  readonly texts: readonly Paint[];
  readonly chain: readonly Layer[];
}

/**
 * What a utility paints, as Tailwind compiles it: a layer-1 token at some
 * alpha, as ground (`background-color`) or text (`color`); nothing (not a
 * colour, or `transparent` / `currentcolor` / `inherit`); or a colour that is
 * no layer-1 token — a palette value such as `text-amber-600`, which no
 * design system re-colours and this guard cannot measure, so it fails.
 */
type Resolved =
  | { readonly kind: "ground" | "text"; readonly token: string; readonly alpha: number }
  | { readonly kind: "none" }
  | { readonly kind: "unresolved"; readonly value: string };

const RESOLVED = new Map<string, Resolved>();

function compileUtility(utility: string): Resolved {
  const role = ROLE_TEXT.get(utility);
  if (role !== undefined) return { kind: "text", token: role, alpha: 1 };
  const css = TAILWIND.candidatesToCss([utility])[0] ?? "";
  const decl = /(?<![\w-])(background-color|color):\s*([^;]+);/.exec(css);
  if (decl === null) return { kind: "none" };
  const value = (decl[2] ?? "").trim();
  if (/^(transparent|currentcolor|inherit)$/i.test(value)) return { kind: "none" };
  const ref =
    /^var\((--[\w-]+)\)$/.exec(value) ??
    /^color-mix\(in oklab, var\((--[\w-]+)\) ([\d.]+)%, transparent\)$/.exec(value);
  const token = ref?.[1];
  if (token === undefined || !DEFAULT.base.has(token)) return { kind: "unresolved", value };
  const alpha = ref?.[2] === undefined ? 1 : Number(ref[2]) / 100;
  return { kind: decl[1] === "background-color" ? "ground" : "text", token, alpha };
}

function resolveUtility(utility: string): Resolved {
  let hit = RESOLVED.get(utility);
  if (hit === undefined) RESOLVED.set(utility, (hit = compileUtility(utility)));
  return hit;
}

/** A class's utility (after its variants) and whether it has any, split at `:` outside brackets. */
function splitVariants(candidate: string): { utility: string; varied: boolean } {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) last = i;
  }
  return { utility: candidate.slice(last + 1), varied: last >= 0 };
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
  const unresolved: string[] = [];
  const classes: string[] = [];
  for (const literal of isNode(value) ? classLiterals(value) : []) {
    const hits = new Scanner({}).getCandidatesWithPositions({
      content: literal.text,
      extension: "html",
    });
    for (const { candidate } of hits) {
      classes.push(candidate);
      const { utility, varied } = splitVariants(candidate);
      const paint = resolveUtility(utility);
      const always = !literal.conditional && !varied;
      if (paint.kind === "ground") grounds.push({ token: paint.token, alpha: paint.alpha, always });
      else if (paint.kind === "text")
        texts.push({ token: paint.token, alpha: paint.alpha, always });
      else if (paint.kind === "unresolved") unresolved.push(`${candidate} (${paint.value})`);
    }
  }
  return { layer: { grounds, texts, unresolved }, classes };
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

/**
 * One module's text sites, every element's chain by class (for MOUNTS), and
 * every colour class that names no token, as `file:line: class (value)`.
 */
function scanModule(file: string, source: string) {
  const sites: Site[] = [];
  const unresolved: string[] = [];
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
    const at = `${file}:${lineOf(node.start)}`;
    for (const c of classes) if (!hosts.has(c)) hosts.set(c, own);
    for (const u of layer.unresolved) unresolved.push(`${at}: ${u}`);
    if (holdsText(node)) sites.push({ at, texts, chain: own });
    for (const child of childrenOf(node)) walk(child, own, texts);
  };
  walk(parseSync(file, source).program as unknown as AstNode, [], ROOT_TEXT);
  return { sites, hosts, unresolved };
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

/** Every site, mounted ones included, and every unresolved colour class; a stale mount throws. */
function scanUi(
  modules: ReadonlyMap<string, string>,
  mounts = MOUNTS,
): { sites: Site[]; unresolved: string[] } {
  const byFile = new Map([...modules].map(([file, source]) => [file, scanModule(file, source)]));
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
  const scans = [...byFile.values()];
  return {
    sites: [...scans.flatMap((f) => f.sites), ...mounted],
    unresolved: scans.flatMap((f) => f.unresolved).toSorted(),
  };
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
function tintFailures(sites: readonly Site[], value: (token: string) => string): string[] {
  const cache = new Map<string, Rgb>();
  const rgb = (token: string) => {
    let hit = cache.get(token);
    if (hit === undefined) cache.set(token, (hit = rgbOf(value(token))));
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

/** The default's light values, which the red cases measure against. */
const KB_LIGHT = (token: string) => SHEETS.resolve(DEFAULT_DESIGN_SYSTEM, "light", token);

describe("design systems: contrast on composited grounds (WCAG AA)", () => {
  const { sites, unresolved } = scanUi(uiModules());
  const cases = DESIGN_SYSTEM_IDS.flatMap((id) =>
    (["light", "dark"] as const).map((variant) => ({ id, variant })),
  );

  it("every colour class the UI writes paints a design-system token", () => {
    expect(unresolved).toEqual([]);
  });

  it("the red case: a palette colour is reported, keywords and non-colours are not", () => {
    const fixture = new Map([
      [
        "chip.tsx",
        '<span className="bg-amber-500/10 text-label text-amber-600 bg-transparent text-current hover:text-foreground/40">!</span>;',
      ],
    ]);
    expect(scanUi(fixture, []).unresolved).toEqual([
      "chip.tsx:1: bg-amber-500/10 (color-mix(in oklab, var(--color-amber-500) 10%, transparent))",
      "chip.tsx:1: text-amber-600 (var(--color-amber-600))",
    ]);
  });

  it("finds the UI's tinted text sites", () => {
    const tinted = sites.filter((s) => s.chain.some((l) => l.grounds.some((p) => p.alpha < 1)));
    expect(tinted.length).toBeGreaterThan(20);
  });

  it.each(cases)("$id/$variant text meets AA on every tint it sits on", ({ id, variant }) => {
    expect(tintFailures(sites, (t) => SHEETS.resolve(id, variant, t))).toEqual([]);
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
    const found = tintFailures(scanUi(fixture, []).sites, KB_LIGHT);
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.every((f) => f.startsWith("chip.tsx:2: --warning on --") && f.includes("/60%")),
    ).toBe(true);
  });

  it("the red case: a selected row's two guarded tints combine under a mounted link", () => {
    // node-row.tsx's shape: each layer paints its tint only while selected.
    const fixture = new Map([
      [
        "row.tsx",
        [
          '<div className={cn("node-row", isSelected && !isActive && "bg-primary/5")}>',
          '  <div className={cn("node-content", isSelected && !isActive && "bg-primary/8")}>',
          "    {content}",
          "  </div>",
          "</div>;",
        ].join("\n"),
      ],
      ["md.tsx", '<a className="kb-md-ref">{label}</a>;'],
    ]);
    const mounts = [{ host: "row.tsx", at: "node-content", guest: "md.tsx" }];
    const onPage = (primary: string) =>
      tintFailures(scanUi(fixture, mounts).sites, (t) =>
        t === "--primary" ? primary : KB_LIGHT(t),
      ).filter((f) => f.startsWith("md.tsx:1 in row.tsx: --primary on --background"));
    const both = "md.tsx:1 in row.tsx: --primary on --background + --primary/5% + --primary/8%";
    // The primary this guard replaced: the combined ground is 3.97:1.
    expect(onPage("oklch(0.57 0.135 58)")).toContain(`${both}: 3.97`);
    // A primary that clears each tint alone: only the combination fails.
    expect(onPage("oklch(0.545 0.13 58)")).toEqual([`${both}: 4.37`]);
    // The shipped primary clears it.
    expect(onPage(KB_LIGHT("--primary"))).toEqual([]);
    expect(() => scanUi(fixture, [{ host: "row.tsx", at: "gone", guest: "md.tsx" }])).toThrow(
      /stale mount/,
    );
  });
});
