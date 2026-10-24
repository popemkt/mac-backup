// The performance and accessibility budget, as a gate on the generated
// stylesheet: what may animate, how long, and that reduced motion and the
// suspend attribute are honoured everywhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EFFECT_IDS, effectAttribute, MAX_DURATION_MS } from "../src/domain/index.ts";
import { buildStylesheet } from "../src/dom/stylesheet.ts";
import { TARGETS } from "./harness.ts";

const css = buildStylesheet(TARGETS);
const COMPOSITOR_ONLY = new Set(["opacity", "transform", "scale", "translate"]);
const LAYOUT_OR_PAINT = new Set(["width", "height", "top", "left", "right", "bottom", "inset", "margin", "padding", "box-shadow", "filter", "all"]);

/** `@keyframes name { ... }` bodies (one level of nested braces). */
function keyframes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gu)) {
    found.set(match[1] ?? "", match[2] ?? "");
  }
  return found;
}

test("keyframes move only transform and opacity", () => {
  const frames = keyframes(css);
  assert.ok(frames.size >= 6, "every keyframe was found");
  for (const [name, body] of frames) {
    for (const declaration of body.matchAll(/([a-z-]+)\s*:/gu)) {
      assert.ok(COMPOSITOR_ONLY.has(declaration[1] ?? ""), `${name} animates ${declaration[1]}`);
    }
  }
});

test("transitions lively adds never include layout or paint-heavy properties", () => {
  for (const match of css.matchAll(/transition(-property)?\s*:\s*([^;]+);/gu)) {
    const value = match[2] ?? "";
    const properties = match[1] === undefined ? value.split(",").map((part) => part.trim().split(/\s+/u)[0] ?? "") : value.split(",").map((part) => part.trim());
    for (const property of properties) assert.ok(!LAYOUT_OR_PAINT.has(property), `transition on ${property}`);
  }
});

test("no base duration runs over the budget", () => {
  for (const match of css.matchAll(/calc\((\d+)ms \* var\(--lively-speed\)\)/gu)) {
    assert.ok(Number(match[1]) <= MAX_DURATION_MS, `${match[1]}ms`);
  }
  assert.ok(!/animation[^;]*\binfinite\b/u.test(css), "no loops");
});

test("reduced motion: a forced level and the OS media query both swap in the calm tokens", () => {
  assert.match(css, /:root\[data-lively="reduced"\] \{[^}]*--lively-rise: 0px;/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*:root\[data-lively-source="system"\] \{[^}]*--lively-press-scale: 1;/u);
});

test("every effect has rules, all scoped to its root attribute and paused while the host measures", () => {
  for (const effect of EFFECT_IDS) {
    const attribute = effectAttribute(effect);
    assert.ok(css.includes(`:root[${attribute}]:not([data-measuring])`), effect);
  }
  // Valued root attributes (`data-lively-speed="snappy"`) are tokens, not effects, so the pattern skips them.
  const scoped = [...css.matchAll(/:root\[data-lively-[a-z-]+\]([^ {]*)/gu)];
  assert.ok(scoped.length > EFFECT_IDS.length);
  for (const match of scoped) assert.ok(match[1]?.startsWith(":not([data-measuring])"), match[0]);
});

test("will-change lives only on the one-animation enter class", () => {
  const rules = [...css.matchAll(/([^{}]+)\{[^{}]*will-change[^{}]*\}/gu)].map((match) => match[1]?.replaceAll(/\/\*.*?\*\//gu, "").trim());
  assert.deepEqual(rules, [':root[data-lively-list-enter]:not([data-measuring]) .lively-enter']);
});

test("host selectors are wrapped in :is(), so a list of them stays one compound", () => {
  assert.ok(css.includes(":is(button, [role=button]):not(:is([data-drag-handle])):not(:disabled):active"));
});
