/**
 * The design-system contract (DESIGN-UI.md → Design tokens → Design
 * systems): every design system contributed to `DesignSystemPoint` — core's
 * default, the page's families' and a plugin's own — answers to its key's
 * id and is labelled; its sheet holds only its own two blocks, and with
 * layer 1 its id names exactly one base block and one dark block (the
 * default's are layer 1's own); it restates every token layer 1 sets, in
 * every variant layer 1 sets it, except the shared and the derived ones,
 * and sets no shared and no unknown token; every layer-1 token resolves for
 * it in light and in dark, and every colour among them parses; the painter
 * adds its sheet after every sheet on the page, and choosing it paints the
 * page in it; a choice nobody contributes, or a system whose plugin
 * unloads, paints the default.
 *
 * A system with a missing token, a block under another id, a shared token
 * of its own, or a sheet the page never adds fails here; the rejecting
 * cases below hold the checks to that.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { definePlugin } from "@kb/plugin";
import {
  browserHost,
  currentContributions,
  DesignSystemPoint,
  oklchToRgb,
  provideDesignSystem,
  syncUiPlugins,
  type DesignSystem,
  type DesignSystemKey,
} from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { PreferencesPopover } from "@/components/prefs/preferences-popover";
import { designSystemsUiPlugin } from "@/design-systems";
import {
  baseSelector,
  darkSelector,
  type DesignSystemSheets,
  type Variant,
} from "@/lib/design-system-sheets";
import {
  PAINTED_STORAGE_KEY,
  SHEET_ATTRIBUTE,
  startDesignSystems,
} from "@/stores/design-system.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { PAGE_FAMILIES, sheetsOf } from "@/test-support/design-systems";
import { syncPagePlugins } from "@/test-support/page-plugins";

const VARIANTS: readonly Variant[] = ["light", "dark"];

/**
 * The inheritance rule. A system restates every token layer 1 sets, in
 * every variant layer 1 sets it, except:
 *  - shared tokens: the JSON Canvas presets are document colours — a card
 *    saved as "red" is red in every skin — so no system's sheet may set them;
 *  - derived tokens: a layer-1 value that is only a reference to another
 *    token (`--lab-accent: var(--primary)`) follows that token, so a system
 *    inherits it unless it restates it on purpose.
 */
const isShared = (token: string) => token.startsWith("--canvas-color-");

/** Layer 1's own declarations, read once: what a plugin's system copies and what each is held to. */
const LAYER1 = sheetsOf([]).layer1;
const isDerived = (token: string) => /^var\(--[\w-]+\)$/.test(LAYER1.base.get(token) ?? "");
const restated = (decls: ReadonlyMap<string, string>) =>
  [...decls].filter(([token]) => !isShared(token) && !isDerived(token));

/** A block of `decls` under `selector`, as a sheet holds it. */
const block = (selector: string, decls: readonly (readonly [string, string])[]) =>
  `${selector} {\n${decls.map(([token, value]) => `  ${token}: ${value};`).join("\n")}\n}\n`;

/** A plugin's own system: layer 1's values restated under its id, so it is complete by construction. */
const PLAIN_KEY: DesignSystemKey = { id: "plain.plain", label: "Plain" };
const PLAIN_SHEET =
  block(baseSelector(PLAIN_KEY.id), restated(LAYER1.base)) +
  block(darkSelector(PLAIN_KEY.id), restated(LAYER1.dark));
const plainPlugin = definePlugin({
  name: "plain",
  apply: (ctx) =>
    ctx.contribute(DesignSystemPoint, provideDesignSystem(PLAIN_KEY, { stylesheet: PLAIN_SHEET })),
});

/** Everything the contract says `id` breaks, read from `sheets`; none for a sound system. */
function contractFailures(sheets: DesignSystemSheets, id: string): readonly string[] {
  const system = sheets.systems.get(id);
  if (system === undefined) return [`${id}: not read`];
  const failures: string[] = [];
  const { base, dark } = system.named;
  if (base !== 1 || dark !== 1)
    failures.push(`${id}: ${base} base and ${dark} dark blocks name it`);
  for (const own of system.blocks) {
    if (own.selector !== baseSelector(id) && own.selector !== darkSelector(id))
      failures.push(`${id}: its sheet holds a block for ${own.selector}`);
    for (const token of own.decls.keys()) {
      if (isShared(token)) failures.push(`${id}: sets the shared ${token}`);
      else if (!LAYER1.base.has(token))
        failures.push(`${id}: sets ${token}, which layer 1 does not`);
    }
  }
  for (const [layer, own, variant] of [
    [LAYER1.base, system.base, "base"],
    [LAYER1.dark, system.dark, "dark"],
  ] as const) {
    for (const [token] of restated(layer))
      if (!own.has(token)) failures.push(`${id}: its ${variant} block leaves ${token} to layer 1`);
  }
  for (const variant of VARIANTS) {
    for (const token of LAYER1.base.keys()) {
      try {
        const value = sheets.resolve(id, variant, token);
        if (value.startsWith("oklch(") && oklchToRgb(value) === null)
          failures.push(`${id}/${variant}: ${token} is no colour (${value})`);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return failures;
}

/** Every design system the page's kernel holds now. */
const contributed = (): readonly DesignSystem[] =>
  currentContributions(DesignSystemPoint).map(({ value }) => value);

const html = () => document.documentElement;
const sheetOf = (id: string) =>
  [...document.head.querySelectorAll(`style[${SHEET_ATTRIBUTE}]`)].find(
    (element) => element.getAttribute(SHEET_ATTRIBUTE) === id,
  );

describe("every contributed design system", () => {
  let installed: InstalledDom;
  let stop: () => void;

  const g = globalThis as Record<string, unknown>;
  const savedStorage = g.localStorage;

  beforeAll(() => {
    installed = installDomGlobals();
    g.IS_REACT_ACT_ENVIRONMENT = true;
    // Where the painter records its paint for the next boot.
    g.localStorage = installed.window.localStorage;
    // A bundled sheet already on the page: the painter's must follow it.
    const bundled = document.createElement("style");
    bundled.id = "bundled";
    document.head.appendChild(bundled);
    syncPagePlugins([designSystemsUiPlugin, ...PAGE_FAMILIES, plainPlugin]);
    stop = startDesignSystems();
  });
  afterAll(() => {
    stop();
    usePrefsStore.getState().setDesignSystem(null);
    syncUiPlugins([]);
    g.localStorage = savedStorage;
    installed.restore();
  });

  it("counts core's default first, the page's families' systems and a plugin's own", () => {
    const ids = contributed().map(({ key }) => key.id);
    expect(ids[0]).toBe("kb");
    expect(ids).toContain(PLAIN_KEY.id);
    expect(ids.length).toBeGreaterThan(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("answers to its key's id, and is labelled", () => {
    for (const { id, value } of currentContributions(DesignSystemPoint)) {
      expect(id).toBe(value.key.id);
      expect(value.key.label.length, id).toBeGreaterThan(0);
    }
  });

  it("is its own two blocks over layer 1, complete in both variants, every colour parsing", () => {
    const sheets = sheetsOf(contributed());
    for (const { key } of contributed()) expect(contractFailures(sheets, key.id)).toEqual([]);
  });

  it("is added to the page after every sheet already on it", () => {
    const after = [...document.head.children].findIndex((element) => element.id === "bundled");
    for (const { key, stylesheet } of contributed()) {
      if (stylesheet === "") continue;
      const sheet = sheetOf(key.id);
      expect(sheet?.textContent, key.id).toBe(stylesheet);
      expect([...document.head.children].indexOf(sheet as Element)).toBeGreaterThan(after);
    }
  });

  it("paints the page once chosen, and the appearance names it", () => {
    for (const { key, stylesheet } of contributed()) {
      act(() => usePrefsStore.getState().setDesignSystem(key.id));
      expect(html().getAttribute("data-theme")).toBe(key.id);
      expect(browserHost().appearance().designSystem).toBe(key.id);
      expect(JSON.parse(localStorage.getItem(PAINTED_STORAGE_KEY) ?? "null")).toEqual({
        id: key.id,
        stylesheet,
      });
    }
  });

  it("with nothing chosen, or a choice nobody contributes, the default", () => {
    act(() => usePrefsStore.getState().setDesignSystem(PLAIN_KEY.id));
    act(() => usePrefsStore.getState().setDesignSystem(null));
    expect(html().getAttribute("data-theme")).toBe("kb");
    act(() => usePrefsStore.getState().setDesignSystem(PLAIN_KEY.id));
    act(() => usePrefsStore.getState().setDesignSystem("gone.gone"));
    expect(html().getAttribute("data-theme")).toBe("kb");
  });

  it("whose plugin unloads: its sheet leaves the page, and a page it painted falls to the default", () => {
    act(() => usePrefsStore.getState().setDesignSystem(PLAIN_KEY.id));
    act(() => syncPagePlugins([designSystemsUiPlugin, ...PAGE_FAMILIES]));
    expect(sheetOf(PLAIN_KEY.id)).toBeUndefined();
    expect(html().getAttribute("data-theme")).toBe("kb");
    act(() => syncPagePlugins([designSystemsUiPlugin, ...PAGE_FAMILIES, plainPlugin]));
    expect(html().getAttribute("data-theme")).toBe(PLAIN_KEY.id);
  });

  describe("the checks reject", () => {
    const broken = (stylesheet: string) =>
      contractFailures(sheetsOf([{ key: PLAIN_KEY, stylesheet }]), PLAIN_KEY.id);
    const missing = restated(LAYER1.base).slice(1);

    it("a system that leaves a token to layer 1", () => {
      const sheet =
        block(baseSelector(PLAIN_KEY.id), missing) +
        block(darkSelector(PLAIN_KEY.id), restated(LAYER1.dark));
      expect(broken(sheet)).toEqual([
        `${PLAIN_KEY.id}: its base block leaves ${restated(LAYER1.base)[0]?.[0]} to layer 1`,
      ]);
    });

    it("a block under another id, or none of its own", () => {
      expect(broken(PLAIN_SHEET + block(baseSelector("other"), []))).toContain(
        `${PLAIN_KEY.id}: its sheet holds a block for ${baseSelector("other")}`,
      );
      expect(broken("")).toContain(`${PLAIN_KEY.id}: 0 base and 0 dark blocks name it`);
    });

    it("a shared token, or one layer 1 does not set", () => {
      const sheet = PLAIN_SHEET + block(baseSelector(PLAIN_KEY.id), [["--canvas-color-1", "red"]]);
      expect(broken(sheet)).toContain(`${PLAIN_KEY.id}: sets the shared --canvas-color-1`);
      expect(
        broken(PLAIN_SHEET.replace("--background:", "--backgroung:")).some((failure) =>
          failure.includes("--backgroung, which layer 1 does not"),
        ),
      ).toBe(true);
    });

    it("a colour that does not parse", () => {
      const sheet = PLAIN_SHEET.replace(/--foreground: [^;]+;/, "--foreground: oklch(nope);");
      expect(broken(sheet).some((failure) => failure.includes("--foreground is no colour"))).toBe(
        true,
      );
    });
  });

  describe("in Preferences", () => {
    let container: HTMLElement;
    let root: Root;

    beforeAll(() => {
      useUiStore.getState().setPrefsOpen(true);
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() =>
        root.render(createElement(PreferencesPopover, { switches: [], onSwitch: () => {} })),
      );
    });
    afterAll(() => {
      act(() => root.unmount());
      container.remove();
      useUiStore.getState().setPrefsOpen(false);
    });

    const swatches = () => [...container.querySelectorAll('[role="radio"]')];

    it("offers one live swatch per contributed system, in contribution order", () => {
      expect(swatches().map((swatch) => swatch.getAttribute("data-testid"))).toEqual(
        contributed().map(({ key }) => `design-system-${key.id}`),
      );
      expect(
        swatches().map((swatch) =>
          swatch.querySelector("[data-theme]")?.getAttribute("data-theme"),
        ),
      ).toEqual(contributed().map(({ key }) => key.id));
    });

    it("is chosen there, and the page and the swatch then show it", () => {
      const swatch = swatches().find(
        (candidate) => candidate.getAttribute("data-testid") === `design-system-${PLAIN_KEY.id}`,
      );
      act(() => (swatch as HTMLElement | undefined)?.click());
      expect(html().getAttribute("data-theme")).toBe(PLAIN_KEY.id);
      expect(swatch?.getAttribute("aria-checked")).toBe("true");
    });
  });
});
