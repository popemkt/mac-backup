// The performance and accessibility budget, as a gate on the generated
// stylesheet: what may animate, that every number is an intensity token,
// that loops are confined, and that reduced motion and the suspend attribute
// are honoured everywhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EFFECT_IDS, effectAttribute, INTENSITIES } from "../src/domain/index.ts";
import { buildStylesheet } from "../src/dom/stylesheet.ts";
import { TARGETS } from "./harness.ts";

const css = buildStylesheet(TARGETS);
const ANIMATABLE = new Set(["opacity", "transform", "scale", "translate", "rotate", "filter"]);
const LAYOUT_OR_PAINT = new Set(["width", "height", "top", "left", "right", "bottom", "inset", "margin", "padding", "box-shadow", "all"]);

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

test("keyframes move only transform, opacity and filter", () => {
  const frames = keyframes(css);
  assert.ok(frames.size >= 10, "every keyframe was found");
  for (const [name, body] of frames) {
    for (const declaration of body.matchAll(/([a-z-]+)\s*:/gu)) {
      assert.ok(ANIMATABLE.has(declaration[1] ?? ""), `${name} animates ${declaration[1]}`);
    }
  }
});

test("transitions lively adds never include layout or paint-heavy properties", () => {
  for (const match of css.matchAll(/transition(-property)?\s*:\s*([^;]+);/gu)) {
    const value = match[2] ?? "";
    const properties =
      match[1] === undefined ? value.split(",").map((part) => part.trim().split(/\s+/u)[0] ?? "") : value.split(",").map((part) => part.trim());
    for (const property of properties) assert.ok(!LAYOUT_OR_PAINT.has(property), `transition on ${property}`);
  }
});

test("effect rules carry no numbers of their own: durations, distances and easings are tokens", () => {
  for (const [selector, body] of rules(css)) {
    if (!selector.includes("[data-lively-") || selector.includes("data-lively-intensity") || /data-lively(-source)?="/u.test(selector.split(" ")[0] ?? "")) continue;
    for (const match of body.matchAll(/(animation|transition)(-[a-z-]+)?\s*:\s*([^;]+);/gu)) {
      assert.ok(!/\d+(ms|s)\b/u.test(match[3] ?? ""), `${selector}: ${match[0]}`);
      assert.ok(!/cubic-bezier|linear\(/u.test(match[3] ?? ""), `${selector}: ${match[0]}`);
    }
  }
});

test("loops are only the breathing glows, only at the full level, and stop under the OS preference", () => {
  const looping = rules(css).filter(([, body]) => /\binfinite\b/u.test(body));
  assert.equal(looping.length, 2, looping.map(([selector]) => selector).join("\n"));
  for (const [selector] of looping) assert.ok(selector.startsWith(':root[data-lively="full"]'), selector);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.working\) \{ animation: none; \}/u);
});

test("one-shot animations on host elements leave nothing behind (no forwards or both fill)", () => {
  for (const [selector, body] of rules(css)) {
    if (!/animation:/u.test(body) || /\binfinite\b/u.test(body)) continue;
    // The press-in holds its sink while :active, and lets go with it.
    if (selector.includes(":active")) continue;
    assert.ok(!/\b(forwards|both)\b/u.test(body), selector);
  }
});

test("every intensity and the reduced level define the same tokens", () => {
  const names = (block: string) => [...block.matchAll(/(--lively-[a-z0-9-]+):/gu)].map((match) => match[1] ?? "").toSorted((a, b) => a.localeCompare(b));
  const blocks = INTENSITIES.map((intensity) => css.match(new RegExp(`:root\\[data-lively-intensity="${intensity}"\\]:where\\(\\[data-lively-style="clean"\\]\\) \\{([^}]*)\\}`, "u"))?.[1] ?? "");
  const reduced = css.match(/:root\[data-lively="reduced"\] \{([^}]*)\}/u)?.[1] ?? "";
  for (const block of [...blocks, reduced]) assert.deepEqual(names(block), names(blocks[0] ?? ""));
  assert.ok(names(reduced).length >= 18);
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
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*:root\[data-lively-source="system"\] \{[^}]*--lively-press-scale: 1;[^}]*--lively-burst-opacity: 0;/u);
});

test("every effect has rules, all scoped to its root attribute and paused while the host measures", () => {
  for (const effect of EFFECT_IDS) {
    const attribute = effectAttribute(effect);
    assert.ok(new RegExp(`\\[${attribute}\\]:not\\(\\[data-measuring\\]\\)`, "u").test(css), effect);
  }
  // Valued root attributes (`data-lively-speed="snappy"`) are tokens, not effects, so the pattern skips them.
  const scoped = [...css.matchAll(/\[data-lively-[a-z-]+\]([^ {]*)/gu)];
  assert.ok(scoped.length > EFFECT_IDS.length);
  for (const match of scoped) assert.ok(match[1]?.startsWith(":not([data-measuring])"), match[0]);
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
