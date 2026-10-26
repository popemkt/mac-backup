// Control: the preset, its three canvas effects and their CSS halves, and HTML-in-Canvas
// detection across both API generations.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { EFFECTS, effectAttribute, NO_CHOICES, resolve, resolveMotion } from "../src/domain/index.ts";
import { detectDrawable } from "../src/dom/drawable.ts";
import { createLively } from "../src/dom/lively.ts";
import { buildStylesheet, ROOT } from "../src/dom/stylesheet.ts";
import { page, TARGETS } from "./harness.ts";

const close: Array<() => void> = [];
afterEach(() => {
  for (const done of close.splice(0)) done();
});

const CANVAS_EFFECTS = ["shiftWarp", "hissResonance", "prismEdge"] as const;

test("control: the whole look in one choice, its three effects its own", () => {
  const { settings } = resolve({ ...NO_CHOICES, preset: "control" });
  assert.deepEqual([settings.style, settings.intensity, settings.stickers, settings.palette, settings.effects.pageWipe], ["clean", "lively", "off", "lively-control", true]);
  const full = resolveMotion(settings, false).effects;
  for (const effect of CANVAS_EFFECTS) {
    assert.ok(full.includes(effect), effect);
    assert.deepEqual(EFFECTS[effect].presets, ["control"]);
    assert.ok(!resolveMotion(resolve({ ...NO_CHOICES, preset: "zzz" }).settings, false).effects.includes(effect), `${effect} is Control's alone`);
  }
  assert.deepEqual(
    CANVAS_EFFECTS.map((effect) => EFFECTS[effect].canvas),
    ["navigate", "waiting", "send"],
  );
  // The Hiss is a state and stays under reduced motion; the slabs and the prism are movement and go.
  const reduced = resolveMotion(settings, true).effects;
  assert.deepEqual(
    CANVAS_EFFECTS.filter((effect) => reduced.includes(effect)),
    ["hissResonance"],
  );
});

test("control: the CSS halves of the canvas effects stand down while the layer draws them", () => {
  const css = buildStylesheet(TARGETS);
  for (const effect of ["shiftWarp", "prismEdge"] as const) {
    const rules = [...css.matchAll(new RegExp(`^([^{}\\n]*\\[${effectAttribute(effect)}\\][^{]*)\\{`, "gmu"))].map((match) => match[1] ?? "");
    assert.ok(rules.length > 0, effect);
    for (const selector of rules) assert.ok(selector.includes(`:not([${ROOT.canvas}])`), selector);
  }
  // The Hiss's state (the red cast, the burning card, the doubled chant) shows with or without the layer.
  assert.match(css, /\[data-lively-hiss-resonance\]:not\(\[data-measuring\]\) :is\(\.page\):has\(:is\(\.request\)\) :is\(\.request\)::before \{[^}]*content: var\(--lively-chant, ""\);[^}]*text-shadow:/u);
  assert.match(css, /:root\[data-lively-preset="control"\]\[data-lively\] \{[^}]*--lively-wipe-label: "Redacted";[^}]*--lively-chant: "Awaiting\/clearance";/u);
});

test("drawable: none without the API; each generation by its method names", () => {
  const fake = (gl: object | undefined, canvas: object) =>
    ({
      WebGL2RenderingContext: gl === undefined ? undefined : { prototype: gl },
      HTMLCanvasElement: { prototype: canvas },
      devicePixelRatio: 1,
    }) as unknown as Window;
  assert.equal(detectDrawable(fake(undefined, {})), undefined, "no WebGL 2");
  assert.equal(detectDrawable(fake({ texImage2D() {} }, {})), undefined, "no flag: plain WebGL 2");
  const pick = (win: Window) => {
    const found = detectDrawable(win);
    return found === undefined ? undefined : [found.markup, found.upload];
  };
  // Before 150: six arguments; 150–154: three; Chromium 154 already has the 155 upload with the old markup; 155+: both new.
  assert.deepEqual(pick(fake({ texElementImage2D(_a: 0, _b: 0, _c: 0, _d: 0, _e: 0, _f: 0) {} }, {})), ["layoutsubtree", "image-6"]);
  assert.deepEqual(pick(fake({ texElementImage2D(_a: 0, _b: 0, _c: 0) {} }, {})), ["layoutsubtree", "image-3"]);
  assert.deepEqual(pick(fake({ texElementImage2D(_a: 0, _b: 0, _c: 0) {}, texElementSubImage2D() {} }, {})), ["layoutsubtree", "sub-image"]);
  assert.deepEqual(pick(fake({ texElementSubImage2D() {} }, { content: "" })), ["content", "sub-image"]);
});

test("drawable: prepare marks the canvas for its generation", () => {
  const p = page();
  close.push(() => p.close());
  const withMarkup = (content: boolean) =>
    detectDrawable({
      WebGL2RenderingContext: { prototype: { texElementSubImage2D() {} } },
      HTMLCanvasElement: { prototype: content ? { content: "" } : {} },
    } as unknown as Window);
  const canvas = p.doc.createElement("canvas");
  const child = p.doc.createElement("div");
  withMarkup(false)?.prepare(canvas, child);
  assert.ok(canvas.hasAttribute("layoutsubtree") && !child.hasAttribute("drawable"));
  const next = p.doc.createElement("canvas");
  withMarkup(true)?.prepare(next, child);
  assert.equal(next.getAttribute("content"), "drawable");
  assert.ok(child.hasAttribute("drawable"));
});

test("lively: without HTML-in-Canvas, or without a GL to draw with, Control runs on its CSS halves", () => {
  for (const drawable of [null, undefined]) {
    const p = page('<div class="page"><div class="timeline"></div><form class="composer"></form></div>');
    close.push(() => p.close());
    const controller = new AbortController();
    // `undefined` detects from the window (happy-dom has no WebGL 2); `null` says there is none.
    createLively({ window: p.win, signal: controller.signal, targets: TARGETS, settings: { preset: "control", motion: "full" }, drawable });
    assert.ok(p.root.hasAttribute(effectAttribute("shiftWarp")));
    assert.ok(!p.root.hasAttribute(ROOT.canvas));
    assert.equal(p.doc.querySelector("[data-lively-refraction]"), null);
    controller.abort();
  }
});
