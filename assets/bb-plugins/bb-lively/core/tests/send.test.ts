// A send, the same sequence under every preset (dom/send.ts): the words leave as a ghost when the
// composer empties, the echo lands along the path from them, a swapped echo carries on, and the
// turn's first reply arrives as the send did; each preset's form is its own art.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { EFFECT_IDS, effectAttribute, NO_CHOICES, presetById, type PresetId, PRESETS, resolve, resolveMotion, SEND_FORMS } from "../src/domain/index.ts";
import { createLively } from "../src/dom/lively.ts";
import { buildStylesheet, CLASSES, ROOT } from "../src/dom/stylesheet.ts";
import { page, TARGETS } from "./harness.ts";

const close: Array<() => void> = [];
afterEach(() => {
  for (const done of close.splice(0)) done();
});

const PAGE = '<div class="page"><div class="timeline"><div class="row" data-id="a" data-index="0">a</div></div><form class="composer"><div class="text"></div></form><button class="send"></button></div>';

function mounted(settings: Record<string, unknown> = {}) {
  const p = page(PAGE);
  const controller = new AbortController();
  const lively = createLively({ window: p.win, signal: controller.signal, targets: TARGETS, settings: { motion: "full", ...settings }, drawable: null });
  close.push(() => {
    controller.abort();
    p.close();
  });
  return { p, lively };
}

/** Type into the composer and press Enter; the host then clears it, as bb does in its own handler. */
async function send(p: ReturnType<typeof page>, words: string, clear = true): Promise<void> {
  const text = p.doc.querySelector(".composer .text") as HTMLElement;
  text.getBoundingClientRect = () => new p.win.DOMRect(40, 600, 480, 48);
  text.innerHTML = `<div contenteditable="true"><p>${words}</p></div>`;
  const editor = text.querySelector("[contenteditable]") as HTMLElement;
  editor.dispatchEvent(new p.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  if (clear) editor.innerHTML = "<p><br></p>";
  await p.settle();
}

async function append(p: ReturnType<typeof page>, html: string): Promise<Element> {
  const list = p.doc.querySelector(".timeline") as HTMLElement;
  list.insertAdjacentHTML("beforeend", html);
  await p.settle();
  return list.lastElementChild as Element;
}

test("send: the words leave as a ghost when the composer empties, and only then", async () => {
  const { p } = mounted();
  await send(p, "not sent", false);
  assert.equal(p.doc.querySelector("[data-lively-ghost]"), null, "an Enter the host does not act on leaves nothing");
  await send(p, "Hold the line");
  const ghost = p.doc.querySelector<HTMLElement>("[data-lively-ghost]");
  assert.ok(ghost !== null && ghost.getAttribute("aria-hidden") === "true" && ghost.hasAttribute("inert"));
  assert.equal(ghost.textContent, "Hold the line");
  assert.equal(ghost.querySelector("[contenteditable]"), null, "the copy is not editable");
  assert.ok(!ghost.classList.contains(CLASSES.depart), "it holds where the words were until its echo lands");
  const form = p.doc.querySelector(".composer") as HTMLElement;
  assert.ok(form.hasAttribute("data-lively-sending"), "the placeholder waits while the words stand in the composer");
  await append(p, '<div class="row mine" data-id="e" data-index="1"><div class="bubble">Hold the line</div></div>');
  assert.ok(!form.hasAttribute("data-lively-sending"), "and comes back as they go");
});

test("send: the button gathers itself the moment Enter goes down, and lets go as the words leave", async () => {
  const { p } = mounted();
  const button = p.doc.querySelector("button.send") as HTMLElement;
  await send(p, "not yet", false);
  assert.ok(button.classList.contains(CLASSES.arm) && !button.classList.contains(CLASSES.send), "anticipation, before bb acts");
  (p.doc.querySelector(".composer .text [contenteditable]") as HTMLElement).innerHTML = "<p><br></p>";
  await p.settle();
  assert.ok(button.classList.contains(CLASSES.send) && !button.classList.contains(CLASSES.arm), "the release, ahead of bb's confirmation");
});

test("send: the echo lands along the path from the words, and the turn's first reply arrives the same way", async () => {
  const { p } = mounted();
  await send(p, "Hold the line");
  const echo = await append(p, '<div class="row mine" data-id="e" data-index="1"><div class="bubble">Hold the line</div></div>');
  assert.ok(echo.classList.contains(CLASSES.arrive));
  assert.ok((echo as HTMLElement).style.getPropertyValue("--lively-send-dx").endsWith("px"));
  const ghost = p.doc.querySelector("[data-lively-ghost]");
  assert.ok(ghost?.classList.contains(CLASSES.depart), "the ghost goes as the message lands");
  const tool = await append(p, '<div class="row" data-id="t" data-index="2">tool</div>');
  assert.ok(tool.classList.contains(CLASSES.enter) && !tool.classList.contains(CLASSES.reply), "other rows rise in as before");
  const reply = await append(p, '<div class="row reply" data-id="r" data-index="3">ok</div>');
  assert.ok(reply.classList.contains(CLASSES.reply));
  const later = await append(p, '<div class="row reply" data-id="r2" data-index="4">more</div>');
  assert.ok(!later.classList.contains(CLASSES.reply), "only the turn's first reply");
});

test("send: a host's absolute rows keep their place; a static row is anchored for the flight only", async () => {
  const { p } = mounted({ preset: "zzz" });
  await send(p, "Hold the line");
  const placed = await append(p, '<div class="row mine" data-id="e" data-index="1" style="position: absolute; top: 40px"><div class="bubble">Hold</div></div>');
  assert.ok(placed.classList.contains(CLASSES.arrive));
  assert.equal((placed as HTMLElement).style.position, "absolute", "the virtualizer's placement stands");
  await send(p, "Again");
  const flowing = await append(p, '<div class="row mine" data-id="f" data-index="2"><div class="bubble">Again</div></div>');
  assert.ok(flowing.classList.contains(CLASSES.arrive));
  assert.equal((flowing as HTMLElement).style.position, "relative");
  const css = buildStylesheet(TARGETS);
  assert.ok(!/lively-arrive[^{]*\{\s*position: relative/u.test(css), "no stylesheet rule repositions a landing row");
});

test("send: the host swapping the echo's row for its stored one carries the motion on", async () => {
  const { p } = mounted();
  await send(p, "Hold the line");
  const echo = await append(p, '<div class="row mine" data-id="optimistic" data-index="1"><div class="bubble">Hold</div></div>');
  assert.ok(echo.classList.contains(CLASSES.arrive));
  await new Promise((done) => setTimeout(done, 40));
  echo.remove();
  const stored = await append(p, '<div class="row mine" data-id="stored" data-index="1"><div class="bubble">Hold</div></div>');
  assert.ok(stored.classList.contains(CLASSES.arrive), "the new node carries the arrival");
  assert.match((stored as HTMLElement).style.getPropertyValue("--lively-send-delay"), /^-\d+ms$/u, "from where it was");
});

async function sendsAsTheHost(settings: Record<string, unknown>): Promise<void> {
  const { p } = mounted(settings);
  await send(p, "Hold the line");
  assert.equal(p.doc.querySelector("[data-lively-ghost]"), null, JSON.stringify(settings));
  const echo = await append(p, '<div class="row mine" data-id="e" data-index="1">x</div>');
  assert.ok(!echo.classList.contains(CLASSES.arrive));
}

test("send: with the effect off, or motion off, a send leaves the composer as the host does", async () => {
  await sendsAsTheHost({ effects: { sendPulse: false } });
  await sendsAsTheHost({ motion: "off" });
});

test("send: each preset names its form, and a preset without one takes its style's", () => {
  const form = (preset: PresetId) => {
    const resolved = resolve({ ...NO_CHOICES, preset });
    return resolveMotion(resolved.settings, false, resolved.preset.tokens, resolved.preset.send).send;
  };
  assert.deepEqual(
    PRESETS.map((preset) => [preset.id, form(preset.id)]),
    [
      ["custom", "glide"],
      ["calm", "glide"],
      ["lively", "glide"],
      ["zzz", "slap"],
      ["cloudbank", "process"],
      ["yorha", "scan"],
      ["control", "dust"],
    ],
  );
  const wobblyCustom = resolve({ ...NO_CHOICES, style: "wobbly" });
  assert.equal(resolveMotion(wobblyCustom.settings, false, {}, presetById("custom").send).send, "slap");
});

test("send: the root names the form; each form's art runs at the full level only, reduced motion is the fade", () => {
  const { p } = mounted({ preset: "yorha" });
  assert.equal(p.root.getAttribute(ROOT.send), "scan");
  const css = buildStylesheet(TARGETS);
  for (const form of SEND_FORMS) {
    const scoped = [...css.matchAll(new RegExp(`^([^{}\\n]*\\[${ROOT.send}="${form}"\\][^{]*)\\{`, "gmu"))].map((match) => match[1] ?? "");
    const rules = scoped.filter((selector) => selector.includes(`[${effectAttribute("sendPulse")}]`));
    assert.ok(rules.length >= 2, form);
    for (const selector of rules) assert.ok(selector.startsWith(`:root[${ROOT.level}="full"][${ROOT.send}="${form}"]`), selector);
  }
  // The fade every level shares.
  assert.ok(css.includes(`[${effectAttribute("sendPulse")}]:not([data-measuring]) :is(.${CLASSES.arrive}, .${CLASSES.reply}) { animation: lively-enter`));
  assert.ok(EFFECT_IDS.includes("sendPulse") && EFFECT_IDS.includes("prismEdge"), "the dust and the Board's prism both play on a send");
});
