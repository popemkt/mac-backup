// The performance and accessibility budget, as a gate on the generated
// stylesheet: what may animate, that every number is a token, the duration
// budgets per style, that loops are confined, and that reduced motion and the
// suspend attribute are honoured everywhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUDGETS,
  EFFECT_IDS,
  effectAttribute,
  INTENSITIES,
  landsAt,
  MOTION_TOKENS,
  SNAP_LANDS_AT,
  STYLES,
} from "../src/domain/index.ts";
import { buildStylesheet } from "../src/dom/stylesheet.ts";
import { TARGETS } from "./harness.ts";

const css = buildStylesheet(TARGETS);
const ANIMATABLE = new Set(["opacity", "transform", "scale", "translate", "rotate", "filter"]);
const INDIVIDUAL = new Set(["opacity", "scale", "translate", "rotate", "filter"]);
const LAYOUT_OR_PAINT = new Set(["width", "height", "top", "left", "right", "bottom", "inset", "margin", "padding", "box-shadow", "all", "transform"]);
const EFFECT_ATTRIBUTES = new Set(EFFECT_IDS.map(effectAttribute));

/** `@keyframes name { ... }` bodies (one level of nested braces). */
function keyframes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gu)) {
    found.set(match[1] ?? "", match[2] ?? "");
  }
  return found;
}

/** Rules as [selector, body], comments dropped, at-rule wrappers flattened. */
function rules(source: string): Array<[string, string]> {
  const flat = source.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => [
    (match[1] ?? "").replace(/^\s*@media[^{]*\{/u, "").trim(),
    match[2] ?? "",
  ]);
}

/** Rules that belong to an effect (scoped to an effect's root attribute). */
const effectRules = () => rules(css).filter(([selector]) => [...selector.matchAll(/\[(data-lively-[a-z-]+)\]/gu)].some((match) => EFFECT_ATTRIBUTES.has(match[1] ?? "")));

/** The `animation` value of a rule body, split into its comma-separated animations. */
const animationsOf = (body: string) => (body.match(/(?:^|[;\s])animation\s*:\s*([^;]+);/u)?.[1] ?? "").split(",").map((part) => part.trim()).filter(Boolean);

test("keyframes move only scale, translate, rotate, opacity and filter, plus composited transform", () => {
  const frames = keyframes(css);
  assert.ok(frames.size >= 20, "every keyframe was found");
  for (const [name, body] of frames) {
    for (const declaration of body.matchAll(/([a-z-]+)\s*:/gu)) {
      assert.ok(ANIMATABLE.has(declaration[1] ?? ""), `${name} animates ${declaration[1]}`);
    }
  }
});

test("transform appears only in keyframes run with animation-composition: add, never on toasts", () => {
  const transforming = [...keyframes(css)].filter(([, body]) => /\btransform\s*:/u.test(body)).map(([name]) => name);
  assert.deepEqual(transforming, ["lively-skew-in"]);
  for (const [selector, body] of rules(css)) {
    assert.ok(!/(^|[;\s])transform\s*:/u.test(body), `${selector} sets transform outside keyframes`);
    const animations = animationsOf(body);
    const index = animations.findIndex((animation) => transforming.some((name) => animation.startsWith(name)));
    if (index === -1) continue;
    const composition = (body.match(/animation-composition\s*:\s*([^;]+);/u)?.[1] ?? "").split(",").map((part) => part.trim());
    assert.equal(composition[index], "add", `${selector}: ${animations[index]} must compose with add`);
    assert.ok(!selector.includes(TARGETS.toast), `${selector}: never skew a toast`);
  }
});

test("transitions lively adds never include layout, paint-heavy properties or transform", () => {
  for (const match of css.matchAll(/transition(-property)?\s*:\s*([^;]+);/gu)) {
    const value = match[2] ?? "";
    const properties =
      match[1] === undefined ? value.split(",").map((part) => part.trim().split(/\s+/u)[0] ?? "") : value.split(",").map((part) => part.trim());
    for (const property of properties) assert.ok(!LAYOUT_OR_PAINT.has(property), `transition on ${property}`);
  }
});

test("effect rules carry no numbers of their own: durations, delays and easings are tokens", () => {
  const checked = effectRules();
  assert.ok(checked.length > 40);
  for (const [selector, body] of checked) {
    for (const match of body.matchAll(/(animation|transition)(-[a-z-]+)?\s*:\s*([^;]+);/gu)) {
      assert.ok(!/\d+(ms|s)\b/u.test(match[3] ?? ""), `${selector}: ${match[0]}`);
      assert.ok(!/cubic-bezier|linear\(/u.test(match[3] ?? ""), `${selector}: ${match[0]}`);
    }
  }
});

test("budgets: presses stay snappy in both styles; clean caps the total, wobbly caps time to land and the total", () => {
  assert.deepEqual([BUDGETS.wobbly.maxLandMs, BUDGETS.wobbly.maxTotalMs], [120, 560]);
  assert.deepEqual([BUDGETS.clean.maxPressMs, BUDGETS.clean.maxTotalMs], [100, 400]);
  for (const style of STYLES) {
    const budget = BUDGETS[style];
    for (const intensity of INTENSITIES) {
      const tokens = MOTION_TOKENS[style][intensity];
      const at = `${style} × ${intensity}`;
      assert.ok(tokens.pressMs <= budget.maxPressMs, `${at}: press ${tokens.pressMs}`);
      for (const ms of [tokens.releaseMs, tokens.enterMs, tokens.overlayMs, tokens.exitMs, tokens.pulseMs]) assert.ok(ms <= budget.maxTotalMs, `${at}: ${ms} ms`);
      // What springs in (release, arrivals, menus) reaches its target in time; wobbly's rings land on the snap.
      for (const ms of [tokens.releaseMs, tokens.enterMs, tokens.overlayMs]) {
        assert.ok(landsAt(tokens) * ms <= budget.maxLandMs, `${at}: lands at ${Math.round(landsAt(tokens) * ms)} ms of ${ms}`);
      }
      if (style === "wobbly") assert.ok(SNAP_LANDS_AT * tokens.pulseMs <= budget.maxLandMs, `${at}: ring lands at ${SNAP_LANDS_AT * tokens.pulseMs} ms`);
    }
  }
});

test("loops are only the breathing glows, only at the full level, and stop under the OS preference", () => {
  const looping = rules(css).filter(([, body]) => /\binfinite\b/u.test(body));
  assert.equal(looping.length, 4, looping.map(([selector]) => selector).join("\n"));
  for (const [selector] of looping) {
    assert.ok(selector.startsWith(':root[data-lively="full"]'), selector);
    assert.ok(selector.includes(effectAttribute("focusRing")) || selector.includes(effectAttribute("workingGlow")), selector);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.working\),[\s\S]*\.lively-pulse \{ animation: none; \}/u);
});

test("the wobbly variants run at the full level only, so reduced motion is the clean fades", () => {
  const wobblyRules = rules(css).filter(([selector]) => selector.includes('[data-lively-style="wobbly"]') && !selector.includes(":where("));
  assert.ok(wobblyRules.length >= 15);
  for (const [selector] of wobblyRules) assert.ok(selector.startsWith(':root[data-lively="full"][data-lively-style="wobbly"]'), selector);
  // Every effect has a wobbly rule, except those the same in both styles and toasts, which
  // the wobbly tokens alone retime (lively never animates a toast).
  for (const effect of EFFECT_IDS.filter((id) => !["typingGlow", "calmHost", "pageWipe", "toastSpring", "turnFreeze", "glitch", "shiftWarp", "hissResonance", "prismEdge"].includes(id))) {
    assert.ok(wobblyRules.some(([selector]) => selector.includes(`[${effectAttribute(effect)}]`)), effect);
  }
});

test("one-shot animations on host elements leave nothing behind (no forwards or both fill)", () => {
  for (const [selector, body] of rules(css)) {
    if (!/animation:/u.test(body) || /\binfinite\b/u.test(body)) continue;
    // The press-in holds its sink while :active, and lets go with it.
    if (selector.includes(":active")) continue;
    assert.ok(!/\b(forwards|both)\b/u.test(body), selector);
  }
});

test("every (style, intensity) and the reduced level define the same tokens", () => {
  const names = (block: string) => [...block.matchAll(/(--lively-[a-z0-9-]+):/gu)].map((match) => match[1] ?? "").toSorted((a, b) => a.localeCompare(b));
  const blocks = STYLES.flatMap((style) =>
    INTENSITIES.map((intensity) => css.match(new RegExp(`:root\\[data-lively-intensity="${intensity}"\\]:where\\(\\[data-lively-style="${style}"\\]\\) \\{([^}]*)\\}`, "u"))?.[1] ?? ""),
  );
  assert.equal(blocks.length, 6);
  const reduced = css.match(/:root\[data-lively="reduced"\] \{([^}]*)\}/u)?.[1] ?? "";
  for (const block of [...blocks, reduced]) assert.deepEqual(names(block), names(blocks[0] ?? ""));
  assert.ok(names(reduced).length >= 26);
});

test("reduced motion: a forced level and the OS media query both swap in the calm tokens", () => {
  // They outweigh every (style, intensity) block only by coming later at equal specificity:
  // an intensity block may carry one attribute besides :root, the style sits in :where().
  const reducedAt = css.indexOf(':root[data-lively="reduced"] {');
  for (const intensity of INTENSITIES) {
    const at = css.indexOf(`:root[data-lively-intensity="${intensity}"]:where(`);
    assert.ok(at > 0 && at < reducedAt, intensity);
  }
  assert.doesNotMatch(css, /:root\[data-lively-intensity="[a-z]+"\]\[/u);
  assert.match(css, /:root\[data-lively="reduced"\] \{[^}]*--lively-rise: 0px;[^}]*--lively-blur: 0px;/u);
  assert.match(css, /:root\[data-lively="reduced"\] \{[^}]*--lively-squash: 0;[^}]*--lively-skew: 0deg;[^}]*--lively-tilt: 0deg;/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*:root\[data-lively-source="system"\] \{[^}]*--lively-press-scale: 1;[^}]*--lively-burst-opacity: 0;/u);
});

test("every effect has rules, all scoped to its root attribute and paused while the host measures", () => {
  for (const effect of EFFECT_IDS) {
    const attribute = effectAttribute(effect);
    assert.ok(new RegExp(`\\[${attribute}\\]:not\\(\\[data-measuring\\]\\)`, "u").test(css), effect);
  }
  // Every effect attribute in a selector is the last root attribute, followed by the pause.
  const scoped = [...css.matchAll(/\[(data-lively-[a-z-]+)\]([^ {]*)/gu)].filter((match) => EFFECT_ATTRIBUTES.has(match[1] ?? ""));
  assert.ok(scoped.length > EFFECT_IDS.length);
  for (const match of scoped) assert.ok(match[2]?.startsWith(":not([data-measuring])"), match[0]);
});

test("will-change lives only on the one-animation enter class", () => {
  const changing = rules(css).filter(([, body]) => body.includes("will-change"));
  assert.deepEqual(
    changing.map(([selector]) => selector),
    [":root[data-lively-list-enter]:not([data-measuring]) .lively-enter"],
  );
});

test("host selectors are wrapped in :is(), so a list of them stays one compound", () => {
  assert.ok(css.includes(":is(button, [role=button]):not(:is([data-drag-handle])):not(:disabled):active"));
});

test("the page wipe slants with a mask and moves only by translate", () => {
  const wipe = rules(css).find(([selector]) => selector.includes(effectAttribute("pageWipe")) && selector.endsWith("::after"));
  assert.ok(wipe);
  // The panel and its mask are paint properties a preset can replace; lively's own slants at 105°.
  assert.match(wipe[1], /background: var\(--lively-wipe-fill\);[^}]*mask: var\(--lively-wipe-mask\);/u);
  assert.match(css, /--lively-wipe-mask: linear-gradient\(105deg/u);
  assert.match(keyframes(css).get("lively-wipe") ?? "", /translate/u);
  assert.equal(INDIVIDUAL.has("translate"), true);
});

test("a thread switch replays the page keyframes under new names with the same bodies", () => {
  const frames = keyframes(css);
  for (const name of ["lively-page", "lively-page-w", "lively-wipe"]) {
    assert.ok(frames.get(name), name);
    assert.equal(frames.get(`${name}-again`), frames.get(name), `${name}-again`);
  }
  assert.ok(rules(css).some(([selector, body]) => selector.endsWith(".lively-page-in") && body.includes("lively-page-w-again")));
  assert.ok(rules(css).some(([selector]) => selector.includes(":not([data-lively-paged])")), "the mount rule stops once replayed");
});
