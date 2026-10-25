// Presets: the table, the resolver's override semantics, the policy's preset
// effects, the art stylesheet and the root attributes it keys on.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  BUDGETS,
  decodeChoices,
  INTENSITIES,
  landsAt,
  MOTION_TOKENS,
  STYLES,
  tokensFor,
  decodeSettings,
  DEFAULT_SETTINGS,
  EFFECT_IDS,
  EFFECTS,
  effectInPreset,
  NO_CHOICES,
  type Preset,
  PRESET_IDS,
  PRESETS,
  resolve,
  resolveMotion,
} from "../src/domain/index.ts";
import { ART_IMAGE_PROPERTY, buildArtStylesheet } from "../src/dom/art.ts";
import { createLively } from "../src/dom/lively.ts";
import { buildStylesheet, ROOT_ATTRIBUTES } from "../src/dom/stylesheet.ts";
import { page, TARGETS } from "./harness.ts";

test("the table: unique ids, custom first and empty, every value a real setting", () => {
  assert.equal(new Set(PRESET_IDS).size, PRESETS.length);
  assert.equal(PRESETS[0].id, "custom");
  assert.deepEqual(PRESETS[0].values, {});
  for (const preset of PRESETS) {
    const values: Preset["values"] = preset.values;
    for (const key of Object.keys(values)) assert.ok(key in DEFAULT_SETTINGS, `${preset.id}: ${key}`);
    for (const id of Object.keys(values.effects ?? {})) assert.ok((EFFECT_IDS as ReadonlyArray<string>).includes(id), `${preset.id}: ${id}`);
  }
});

test("every effect's presets name real presets", () => {
  for (const id of EFFECT_IDS) for (const preset of EFFECTS[id].presets ?? []) assert.ok((PRESET_IDS as ReadonlyArray<string>).includes(preset), `${id}: ${preset}`);
});

test("nothing set: the custom preset, every field its base default", () => {
  const resolved = resolve(NO_CHOICES);
  assert.deepEqual(resolved.settings, DEFAULT_SETTINGS);
  assert.equal(resolved.sources.style, "default");
  assert.equal(resolved.sources.effects.press, "default");
});

test("a preset fills every field still on From preset, and says so", () => {
  const { settings, sources } = resolve({ ...NO_CHOICES, preset: "zzz" });
  assert.deepEqual(
    [settings.style, settings.intensity, settings.skew, settings.stickers, settings.jelly, settings.effects.pageWipe, settings.palette],
    ["wobbly", "bold", true, "wobbly", "matched", true, "lively-zzz"],
  );
  assert.deepEqual([sources.style, sources.jelly, sources.palette, sources.effects.pageWipe], ["preset", "preset", "preset", "preset"]);
  // What the preset leaves alone keeps its base default.
  assert.deepEqual([settings.motion, sources.motion, settings.speed, sources.speed], ["system", "default", "normal", "default"]);
});

test("an explicit tweak wins over the preset and survives a preset switch", () => {
  const choices = { ...NO_CHOICES, style: "clean", effects: { ...NO_CHOICES.effects, pageWipe: false } } as const;
  for (const preset of ["zzz", "calm", "lively"]) {
    const { settings, sources } = resolve({ ...choices, preset });
    assert.equal(settings.style, "clean", preset);
    assert.equal(sources.style, "explicit", preset);
    assert.equal(settings.effects.pageWipe, false, preset);
  }
  // ...while everything else follows the preset.
  assert.equal(resolve({ ...choices, preset: "calm" }).settings.intensity, "subtle");
  assert.equal(resolve({ ...choices, preset: "zzz" }).settings.intensity, "bold");
});

test("the seed presets: calm is quiet, lively is clean at lively, zzz is the whole ZZZ look", () => {
  const calm = resolve({ ...NO_CHOICES, preset: "calm" }).settings;
  assert.deepEqual([calm.style, calm.intensity, calm.stickers, calm.effects.pageWipe, calm.palette], ["clean", "subtle", "off", false, null]);
  const lively = resolve({ ...NO_CHOICES, preset: "lively" }).settings;
  assert.deepEqual([lively.style, lively.intensity, lively.palette], ["clean", "lively", "lively"]);
  const zzz = PRESETS.find((preset) => preset.id === "zzz");
  assert.ok(zzz?.art.backdrop.layers.length && zzz.art.sidebar.layers.length, "zzz paints its own art, with or without the person's image");
});

test("palette: keep is an explicit no palette; From preset follows the preset, else none", () => {
  assert.equal(resolve({ ...NO_CHOICES, preset: "zzz", palette: "keep" }).settings.palette, null);
  assert.equal(resolve({ ...NO_CHOICES, preset: "zzz", palette: "keep" }).sources.palette, "explicit");
  assert.equal(resolve({ ...NO_CHOICES, preset: "calm" }).settings.palette, null);
  assert.equal(resolve({ ...NO_CHOICES, preset: "calm" }).sources.palette, "default");
});

test("decode: From preset is every field's default; an unknown preset or bad value falls back and is reported", () => {
  assert.deepEqual(decodeChoices({}), { choices: NO_CHOICES, problems: [] });
  const { choices, problems } = decodeChoices({ preset: "transistor", style: "preset", skew: "maybe", palette: "lively", artImage: 'x") ; color: red' });
  assert.deepEqual([choices.preset, choices.style, choices.skew, choices.palette, choices.artImage], ["custom", "preset", "preset", "preset", ""]);
  assert.deepEqual(problems.map((problem) => problem.field).toSorted(), ["artImage", "palette", "preset", "skew"]);
  assert.equal(decodeChoices({ artImage: "https://example.com/art.png" }).choices.artImage, "https://example.com/art.png");
  assert.equal(decodeChoices({ artImage: "/api/v1/plugins/x/http/art" }).choices.artImage, "/api/v1/plugins/x/http/art");
  assert.equal(decodeSettings({ preset: "zzz" }).settings.style, "wobbly");
});

test("a preset's own effect runs only under that preset", () => {
  assert.ok(effectInPreset({ ...EFFECTS.press }, "zzz"));
  assert.ok(effectInPreset({ ...EFFECTS.press, presets: ["zzz"] }, "zzz"));
  assert.ok(!effectInPreset({ ...EFFECTS.press, presets: ["zzz"] }, "calm"));
});

test("the policy carries the preset and the art; art is paint, so it stays reduced and goes with off", () => {
  const settings = { ...DEFAULT_SETTINGS, preset: "zzz", artImage: "https://example.com/a.png" };
  const full = resolveMotion(settings, false);
  assert.deepEqual([full.preset, full.art, full.artImage], ["zzz", true, "https://example.com/a.png"]);
  assert.equal(resolveMotion(settings, true).art, true);
  assert.deepEqual([resolveMotion({ ...settings, motion: "off" }, false).art, resolveMotion({ ...settings, motion: "off" }, false).artImage], [false, ""]);
  assert.equal(resolveMotion({ ...settings, art: false }, false).artImage, "");
});

const FIXTURE: ReadonlyArray<Preset> = [
  { id: "custom", label: "Custom", description: "none", values: {} },
  {
    id: "neon",
    label: "Neon",
    description: "a fixture",
    values: { style: "wobbly" },
    art: { sidebar: { layers: [{ image: "linear-gradient(red, blue)", size: "10px 10px" }], mask: "linear-gradient(#000, transparent)" } },
    fonts: { sans: '"Fixture Sans", sans-serif' },
  },
];

test("art: each preset's layers, fonts and image slot are scoped to it and to the art switch", () => {
  const css = buildArtStylesheet(TARGETS, FIXTURE);
  assert.match(css, /:root\[data-lively-art="on"\]\[data-lively-preset="neon"\] \{\s*--font-sans: "Fixture Sans", sans-serif;/u);
  assert.match(css, /:root\[data-lively-art="on"\]\[data-lively-preset="neon"\] :is\(\.sidebar\)::before \{[^}]*background-image: linear-gradient\(red, blue\);[^}]*background-size: 10px 10px;[^}]*mask: linear-gradient\(#000, transparent\);/u);
  // No preset names an image surface: the person's image goes behind the thread (pageView), under no art of its own.
  assert.match(css, /\[data-lively-art-image="on"\]\[data-lively-preset="neon"\] :is\(\.page, \.dock\)::before \{[^}]*var\(--lively-art-image\)/u);
  assert.match(css, /\[data-lively-art-image="on"\]\[data-lively-preset="custom"\] :is\(\.page, \.dock\)::before/u);
  // Art never animates, and every rule is scoped to a preset and the art switch.
  assert.ok(!/animation|transition/u.test(css));
  for (const [selector] of css.matchAll(/^[^\s/{}][^{]*(?=\{)/gmu)) assert.match(selector, /data-lively-art="on"/u, selector);
});

test("art: the seed table's zzz layers its image under its own art, washed toward the canvas", () => {
  const css = buildArtStylesheet(TARGETS, PRESETS);
  const rule = css.match(/\[data-lively-art-image="on"\]\[data-lively-preset="zzz"\] :is\(\.page, \.dock\)::before \{([^}]*)\}/u)?.[1] ?? "";
  assert.match(rule, /background-image: linear-gradient\(112deg[\s\S]*color-mix\(in oklab, var\(--lively-canvas\) 78%, transparent\)[\s\S]*var\(--lively-art-image\);/u);
  assert.match(rule, /background-repeat: [^;]*no-repeat;/u);
});

let close: Array<() => void> = [];
afterEach(() => {
  for (const step of close) step();
  close = [];
});

test("the DOM layer writes the preset, the art switch and the image, and removes them all", () => {
  const p = page("");
  const controller = new AbortController();
  close.push(() => p.close());
  const lively = createLively({ window: p.win, signal: controller.signal, targets: TARGETS, settings: { preset: "zzz" } });
  assert.equal(p.root.getAttribute("data-lively-preset"), "zzz");
  assert.equal(p.root.getAttribute("data-lively-style"), "wobbly");
  assert.equal(p.root.getAttribute("data-lively-art"), "on");
  assert.ok(!p.root.hasAttribute("data-lively-art-image"));
  lively.setSettings({ preset: "zzz", artImage: "https://example.com/a.png" });
  assert.equal(p.root.getAttribute("data-lively-art-image"), "on");
  assert.equal(p.root.style.getPropertyValue(ART_IMAGE_PROPERTY), 'url("https://example.com/a.png")');
  lively.setSettings({ preset: "zzz", art: false, artImage: "https://example.com/a.png" });
  assert.ok(!p.root.hasAttribute("data-lively-art") && !p.root.hasAttribute("data-lively-art-image"));
  assert.equal(p.root.style.getPropertyValue(ART_IMAGE_PROPERTY), "");
  lively.setSettings({ preset: "zzz", artImage: "https://example.com/a.png" });
  controller.abort();
  for (const name of ROOT_ATTRIBUTES) assert.ok(!p.root.hasAttribute(name), name);
  assert.equal(p.root.style.getPropertyValue(ART_IMAGE_PROPERTY), "");
});

test("art: a backdrop repeats on bb's dock band and hides bb's fade above it; nothing else in the dock changes", () => {
  const css = buildArtStylesheet(TARGETS, PRESETS);
  const scope = String.raw`:root\[data-lively-art="on"\]\[data-lively-preset="zzz"\]`;
  // The band stays opaque (no background override) and paints the same art layers as the thread, anchored to the same corner.
  assert.ok(!/:is\(\.dock\) \{ background/u.test(css));
  assert.match(css, new RegExp(`${scope} :is\\(\\.page, \\.dock\\)::before \\{[^}]*background-position: right bottom, right bottom;`, "u"));
  assert.match(css, new RegExp(`${scope} :is\\(\\.dock-fade\\) \\{ display: none; \\}`, "u"));
  // The composer keeps bb's own surface: lively's art never restyles it.
  assert.ok(!/backdrop-filter/u.test(css));
  assert.ok(!/form\.composer/u.test(css));
  // The person's image is fixed to the window, so the thread and the band show one picture.
  assert.match(css, /\[data-lively-art-image="on"\]\[data-lively-preset="zzz"\] :is\(\.page, \.dock\)::before \{[^}]*background-attachment: scroll, scroll, scroll, fixed;/u);
  // Presets without a backdrop leave bb's dock and fade alone, until the person adds an image.
  assert.ok(!/\[data-lively-art="on"\]\[data-lively-preset="(calm|custom|lively)"\] :is\(\.dock-fade\)/u.test(css));
  assert.match(css, /\[data-lively-art-image="on"\]\[data-lively-preset="custom"\] :is\(\.dock-fade\) \{ display: none; \}/u);
});

test("art: backdrop art never depends on its box's size, so the dock band continues it seamlessly", () => {
  for (const preset of PRESETS as ReadonlyArray<Preset>) {
    const { art } = preset;
    for (const layer of art?.backdrop?.layers ?? []) {
      // Anchored to the bottom-right corner, at most offset from it in fixed pixels.
      assert.match(layer.position ?? "", /^right(?: \d+px)? bottom(?: \d+px)?$/u, `${preset.id}: ${layer.image.slice(0, 30)}`);
      assert.ok(!/%/u.test(layer.size ?? "auto"), `${preset.id}: size ${layer.size}`);
    }
    if (art?.backdrop?.mask !== undefined) assert.match(art.backdrop.mask, /right bottom \/ \d+px \d+px/u, preset.id);
  }
});

test("cloudbank and yorha: each a whole art direction, with its palette, its own effect and its art", () => {
  const cloudbank = resolve({ ...NO_CHOICES, preset: "cloudbank" }).settings;
  assert.deepEqual(
    [cloudbank.style, cloudbank.intensity, cloudbank.stickers, cloudbank.palette, cloudbank.effects.pageWipe, cloudbank.effects.turnFreeze],
    ["clean", "lively", "off", "lively-cloudbank", true, true],
  );
  const yorha = resolve({ ...NO_CHOICES, preset: "yorha" }).settings;
  assert.deepEqual([yorha.style, yorha.speed, yorha.palette, yorha.effects.glitch], ["clean", "snappy", "lively-yorha", true]);
  assert.ok(resolveMotion(cloudbank, false).effects.includes("turnFreeze") && !resolveMotion(cloudbank, false).effects.includes("glitch"));
  assert.ok(resolveMotion(yorha, false).effects.includes("glitch") && !resolveMotion(yorha, false).effects.includes("turnFreeze"));
  // Turn() is a state: it stays under reduced motion; the glitch is a movement and goes.
  assert.ok(resolveMotion(cloudbank, true).effects.includes("turnFreeze"));
  assert.ok(!resolveMotion(yorha, true).effects.includes("glitch"));
  for (const id of ["cloudbank", "yorha"]) {
    const preset = PRESETS.find((row) => row.id === id) as Preset | undefined;
    assert.ok(preset?.art?.backdrop?.layers.length && preset.art.sidebar?.layers.length, id);
    assert.ok(preset.paint?.wipe && preset.paint.chroma, id);
  }
});

test("a preset's own tokens keep the style's budget, at every intensity", () => {
  for (const preset of PRESETS as ReadonlyArray<Preset>) {
    if (preset.tokens === undefined) continue;
    for (const style of STYLES) {
      const budget = BUDGETS[style];
      for (const intensity of INTENSITIES) {
        const tokens = { ...MOTION_TOKENS[style][intensity], ...preset.tokens };
        const at = `${preset.id}: ${style} × ${intensity}`;
        assert.ok(tokens.pressMs <= budget.maxPressMs, at);
        for (const ms of [tokens.releaseMs, tokens.enterMs, tokens.overlayMs, tokens.exitMs, tokens.pulseMs]) assert.ok(ms <= budget.maxTotalMs, `${at}: ${ms} ms`);
        // A spring with no overshoot never lands early, so clean's total cap is its land cap.
        for (const ms of [tokens.releaseMs, tokens.enterMs, tokens.overlayMs]) assert.ok(Math.min(1, landsAt(tokens)) * ms <= budget.maxTotalMs, at);
      }
    }
  }
});

test("a preset's tokens apply at the full level only; reduced motion keeps the reduced tokens", () => {
  const yorha = resolve({ ...NO_CHOICES, preset: "yorha" });
  const full = resolveMotion(yorha.settings, false, yorha.preset.tokens);
  assert.equal(tokensFor(full).overshoot, 0);
  assert.equal(tokensFor(full).blur, 0);
  assert.deepEqual(resolveMotion(yorha.settings, true, yorha.preset.tokens).overrides, {});
  const css = buildStylesheet(TARGETS);
  const blocks = [...css.matchAll(/^(.*\[data-lively-preset="yorha"\][^{]*)\{([^}]*)\}/gmu)].filter((match) => (match[2] ?? "").includes("--lively-spring"));
  assert.equal(blocks.length, 12, "six (style, intensity) blocks, for a forced full level and for the system's");
  for (const [, selector] of blocks) assert.match(selector ?? "", /\[data-lively="full"\]/u);
  // The system's copies sit under the media query that says the OS does not ask for less motion.
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*:root\[data-lively-preset="yorha"\]\[data-lively="full"\]\[data-lively-source="system"\]/u);
  // Cloudbank only brightens the sword's light: its glow, nothing that moves.
  assert.deepEqual(Object.keys(PRESETS.find((preset) => preset.id === "cloudbank")?.tokens ?? {}), ["glow"]);
  assert.ok(!/\[data-lively-preset="(zzz|calm|lively|custom)"\]\[data-lively="full"\]\[data-lively-source/u.test(css), "the seed presets keep the shared tokens");
});

test("a preset's paint recolors the shared effects under that preset only", () => {
  const css = buildStylesheet(TARGETS);
  assert.match(css, /:root\[data-lively-preset="cloudbank"\]\[data-lively\] \{\s*--lively-wipe-fill: [^;]+;\s*--lively-wipe-mask: [^;]+;\s*--lively-chroma-a: var\(--lively-accent\);/u);
  assert.match(css, /:root\[data-lively-preset="yorha"\]\[data-lively\] \{[^}]*--lively-chroma-b: #4a7a8c;/u);
  assert.ok(!/\[data-lively-preset="(zzz|calm|lively|custom)"\]\[data-lively\] \{/u.test(css));
});

test("turnFreeze: the timeline freezes while the page view holds a request, and the request itself never does", () => {
  const css = buildStylesheet(TARGETS);
  const freeze = [...css.matchAll(/^([^{}\n]*\[data-lively-turn-freeze\][^{]*)\{([^}]*)\}/gmu)].map((match) => [(match[1] ?? "").trim(), match[2] ?? ""] as const);
  assert.ok(freeze.length >= 6);
  for (const [selector] of freeze) assert.match(selector, /:is\(\.page\):has\(:is\(\.request\)\)|:is\(\.timeline\) > :is\(\.row\)/u, selector);
  // The dimming filter lands on timeline rows only; the request is lit (a glow, the segmented bar, its Turn() label).
  for (const [selector, body] of freeze) if (/filter:[^;]*saturate/u.test(body)) assert.match(selector, /:is\(\.timeline\) > :is\(\.row\)\s*$/u, selector);
  assert.ok(freeze.some(([selector, body]) => selector.endsWith(":is(.request)::before") && /content: "Turn\(\)"/u.test(body)));
  assert.ok(freeze.some(([selector, body]) => selector.endsWith(":is(.request)::after") && /repeating-linear-gradient/u.test(body)));
  // Coming in moves: full level only (reduced shows the frozen state at once).
  for (const [selector, body] of freeze) if (/animation|transition/u.test(body)) assert.match(selector, /^:root\[data-lively="full"\]/u, selector);
});

test("glitch: a failure tears under yorha even with the status rings off, and never elsewhere", () => {
  const p = page('<div class="thread"></div>');
  close.push(() => p.close());
  const controller = new AbortController();
  const lively = createLively({ window: p.win, signal: controller.signal, targets: TARGETS, settings: { preset: "yorha", effects: { statusPulse: false } } });
  const row = p.doc.querySelector(".thread") as Element;
  assert.equal(lively.pulseStatus(row, "success"), false, "the glitch is for failures; the rings are off");
  assert.equal(lively.pulseStatus(row, "error"), true);
  assert.equal(row.getAttribute("data-lively-tone"), "error");
  controller.abort();
  const other = page('<div class="thread"></div>');
  close.push(() => other.close());
  const plain = createLively({ window: other.win, signal: new AbortController().signal, targets: TARGETS, settings: { preset: "custom", effects: { statusPulse: false } } });
  assert.equal(plain.pulseStatus(other.doc.querySelector(".thread") as Element, "error"), false);
  plain.dispose();
});

test("lettering: Cloudbank prints its functions as calls: the sidebar's loadout (with the art) and Jaunt() across the wipe", () => {
  const css = buildStylesheet(TARGETS);
  assert.match(css, /:root\[data-lively-preset="cloudbank"\]\[data-lively\] \{[^}]*--lively-wipe-label: "Jaunt\(\)";[^}]*--lively-letter-font: [^;]+;/u);
  assert.match(css, /:root\[data-lively-art="on"\]\[data-lively-preset="cloudbank"\] :is\(\.sidebar\)::after \{\s*content: "Crash\(\)[^"]*";/u);
  // Lively's own wipe prints nothing.
  assert.match(css, /--lively-wipe-label: "";/u);
  // A quote or backslash in a preset's words never escapes the CSS string.
  const hostile: ReadonlyArray<Preset> = [{ id: "x", label: "X", description: "", values: {}, lettering: { font: "serif", color: "red", sidebar: 'a"; } body { color: red; } "\\' } }];
  assert.match(buildArtStylesheet(TARGETS, hostile), /content: "a; \} body \{ color: red; \} ";/u);
});
