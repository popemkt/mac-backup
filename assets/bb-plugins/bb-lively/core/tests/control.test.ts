// Control: the preset, its three canvas effects and their CSS halves, its send's dust on the
// same layer, and HTML-in-Canvas detection across both API generations.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CANVAS_TRIGGERS, EFFECT_IDS, EFFECTS, effectAttribute, NO_CHOICES, presetById, PRESETS, resolve, resolveMotion, SEND_FORM_INFO } from "../src/domain/index.ts";
import type { ArtLayer, Preset } from "../src/domain/presets.ts";
import { type Drawable, detectDrawable } from "../src/dom/drawable.ts";
import { createLively } from "../src/dom/lively.ts";
import { createRefraction, REFRACTION_ATTRIBUTE, SCENE_MODES, WAITING_MS } from "../src/dom/refraction.ts";
import { buildStylesheet, ROOT } from "../src/dom/stylesheet.ts";
import { page, TARGETS } from "./harness.ts";

const close: Array<() => void> = [];
afterEach(() => {
  for (const done of close.splice(0)) done();
});

const CANVAS_EFFECTS = ["shiftWarp", "hissResonance", "prismEdge"] as const;

test("control: the whole look in one choice, its canvas effects its own, its send the Hiss's dust", () => {
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
  const control = presetById("control");
  assert.equal(control.send, "dust");
  assert.equal(resolveMotion(settings, false, control.tokens, control.send).send, "dust");
  assert.ok(SEND_FORM_INFO.dust.canvas);
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

test("canvas effects: one contract, two halves; every trigger has its scene and every effect its CSS half", () => {
  assert.deepEqual(Object.keys(SCENE_MODES).toSorted(), [...CANVAS_TRIGGERS].toSorted());
  const css = buildStylesheet(TARGETS);
  for (const effect of EFFECT_IDS.filter((id) => EFFECTS[id].canvas !== undefined)) {
    assert.ok(css.includes(`[${effectAttribute(effect)}]`), `${effect} has a CSS half`);
  }
  // Nothing moves on its own for long: the Hiss resonates under five seconds per request (WCAG 2.2.2).
  assert.ok(WAITING_MS < 5000);
});

/** A WebGL 2 context that accepts every call; it counts the times it is lost. */
function fakeGl(lost: { count: number }): object {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "getExtension") return () => ({ loseContext: () => (lost.count += 1) });
        if (key === "getShaderParameter" || key === "getProgramParameter") return () => true;
        if (typeof key === "string" && /^[A-Z0-9_]+$/u.test(key)) return 0;
        return () => ({});
      },
    },
  );
}
const FAKE_DRAWABLE: Drawable = {
  markup: "layoutsubtree",
  upload: "image-3",
  prepare: (canvas) => canvas.setAttribute("layoutsubtree", ""),
  requestPaint: () => undefined,
  draw: () => ({ width: 1, height: 1 }),
};
const withGl = (p: ReturnType<typeof page>, lost: { count: number }) => {
  const proto = p.win.HTMLCanvasElement.prototype as unknown as { getContext: (kind: string) => unknown };
  const original = proto.getContext;
  proto.getContext = (kind: string) => (kind === "webgl2" ? fakeGl(lost) : null);
  close.push(() => (proto.getContext = original));
};

test("refraction: a scene snapshots a sanitized copy of the thread, scroll kept, frames dropped", () => {
  const p = page('<div class="page"><div class="timeline"><iframe></iframe><div class="rows" id="rows" data-x="1" style="overflow:auto;height:10px"><p>a</p><p>b</p></div></div><form class="composer"></form></div>');
  close.push(() => p.close());
  const lost = { count: 0 };
  withGl(p, lost);
  const layer = createRefraction({ win: p.win, targets: TARGETS, drawable: FAKE_DRAWABLE, duration: () => 100, chant: () => [] });
  assert.ok(layer !== undefined);
  const rows = p.doc.querySelector(".rows");
  assert.ok(rows !== null);
  rows.scrollTop = 7;
  assert.ok(layer.navigate());
  const canvas = p.doc.querySelector<HTMLCanvasElement>(`[${REFRACTION_ATTRIBUTE}]`);
  assert.ok(canvas !== null && canvas.style.display === "block" && canvas.getAttribute("aria-hidden") === "true");
  const copy = canvas.querySelector(".rows");
  assert.ok(copy !== null);
  assert.equal(canvas.querySelector("iframe"), null, "frames dropped");
  assert.ok(!copy.hasAttribute("id") && !copy.hasAttribute("data-x"), "nothing finds the copy by bb's hooks");
  assert.equal(copy.scrollTop, 7, "scroll kept past a dropped element");
  layer.dispose();
  assert.equal(lost.count, 1);
});

test("refraction: without HTML-in-Canvas there are no scenes, only dust", () => {
  const p = page('<div class="page"><div class="timeline"></div><div class="request">Approve?</div></div>');
  close.push(() => p.close());
  withGl(p, { count: 0 });
  const layer = createRefraction({ win: p.win, targets: TARGETS, drawable: undefined, duration: () => 100, chant: () => [] });
  assert.ok(layer !== undefined && !layer.copies);
  assert.equal(layer.navigate(), false);
  assert.equal(layer.send(), false);
  layer.waiting(true);
  assert.ok(!layer.running());
  layer.dispose();
});

/** Type into the composer and send with Enter: the host clears it in its own handler, after lively copied it. */
async function sendWords(p: ReturnType<typeof page>, words: string): Promise<void> {
  const text = p.doc.querySelector(".composer .text") as HTMLElement;
  // happy-dom lays nothing out: give the composer's text box a place.
  text.getBoundingClientRect = () => new p.win.DOMRect(40, 600, 480, 48);
  text.innerHTML = `<div contenteditable="true"><p>${words}</p></div>`;
  const editor = text.querySelector("[contenteditable]") as HTMLElement;
  editor.dispatchEvent(new p.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  editor.innerHTML = "<p><br></p>";
  await p.settle();
}

test("lively: Control's send makes the layer at the send, dissolves a sanitized copy of the words, and lets its GL go below the full level", async () => {
  const p = page('<div class="page"><div class="timeline"></div><form class="composer"><div class="text"></div></form></div>');
  close.push(() => p.close());
  const lost = { count: 0 };
  withGl(p, lost);
  const controller = new AbortController();
  const lively = createLively({ window: p.win, signal: controller.signal, targets: TARGETS, settings: { preset: "control", motion: "full" }, drawable: FAKE_DRAWABLE });
  assert.ok(p.root.hasAttribute(ROOT.canvas), "the CSS halves stand down at once");
  assert.equal(p.root.getAttribute(ROOT.send), "dust");
  assert.equal(p.doc.querySelector(`[${REFRACTION_ATTRIBUTE}]`), null, "no GL context before a scene or a send");
  await sendWords(p, '<span id="m" data-mention="1">Hold</span> the line');
  const canvas = p.doc.querySelector<HTMLCanvasElement>(`[${REFRACTION_ATTRIBUTE}]`);
  assert.ok(canvas !== null && canvas.style.display === "block");
  const copy = [...canvas.querySelectorAll("span")].find((span) => span.textContent === "Hold");
  assert.ok(copy !== undefined && !copy.hasAttribute("id") && !copy.hasAttribute("data-mention"), "the dust's copy is sanitized");
  assert.ok(p.doc.querySelector("[data-lively-ghost]") !== null, "the ghost stands in until the dust's first frame");
  lively.setSettings({ preset: "control", motion: "reduced" });
  assert.equal(p.doc.querySelector(`[${REFRACTION_ATTRIBUTE}]`), null);
  assert.ok(!p.root.hasAttribute(ROOT.canvas));
  assert.equal(lost.count, 1, "its GL context is released");
  controller.abort();
  assert.equal(p.doc.querySelector("[data-lively-ghost]"), null, "nothing of lively's is left behind");
});

test("refraction: the Hiss resonates once per request, again only when the card moves or a new request comes", () => {
  const p = page('<div class="page"><div class="timeline"></div><div class="request">Approve?</div></div>');
  close.push(() => p.close());
  const lost = { count: 0 };
  withGl(p, lost);
  const layer = createRefraction({ win: p.win, targets: TARGETS, drawable: FAKE_DRAWABLE, duration: () => 100, chant: () => ["Hold/release"] });
  assert.ok(layer !== undefined);
  const stage = () => p.doc.querySelector(`[${REFRACTION_ATTRIBUTE}]`)?.firstElementChild?.firstElementChild;
  layer.waiting(true);
  const first = stage();
  assert.ok(first !== undefined && first !== null && layer.running());
  layer.waiting(true);
  assert.equal(stage(), first, "the same request does not restart it");
  layer.waiting(false);
  assert.ok(!layer.running());
  layer.waiting(true);
  assert.notEqual(stage(), first, "a new request resonates again");
  layer.dispose();
  assert.equal(p.doc.querySelector(`[${REFRACTION_ATTRIBUTE}]`), null);
  assert.equal(lost.count, 1);
});

test("control: the art keeps to the free right margin, clear of the reading column and the dock", () => {
  const preset = (PRESETS as ReadonlyArray<Preset>).find((row) => row.id === "control");
  const mask = preset?.art?.backdrop?.mask ?? "";
  // Right of bb's centered column (at most 728px, 16px padding), intersected with a bottom band clear of the dock.
  assert.match(mask, /^linear-gradient\(to left, #000 calc\(50% - min\(364px, 50% - 16px\) - 48px\), transparent calc\(50% - min\(364px, 50% - 16px\) - 24px\)\) intersect, linear-gradient\(to top, transparent 0 250px, #000 290px\) right bottom/u);
  // Every shape floats above the dock.
  const layers: ReadonlyArray<ArtLayer> = preset?.art?.backdrop?.layers ?? [];
  for (const layer of layers) {
    const bottom = /bottom (\d+)px/u.exec(layer.position ?? "");
    if (layer.repeat === "no-repeat" && bottom !== null && !layer.image.includes("radial")) assert.ok(Number(bottom[1]) >= 290, layer.image.slice(0, 40));
  }
});
