// DOM helpers over happy-dom pages: guards across shadow roots, the gi input
// picker. Run: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { editableGuard, focusState, MODAL_SELECTOR, presenceGuard, withinGuard } from "../src/dom/focus.ts";
import { placementCache } from "../src/dom/frames.ts";
import { pickInput, TEXT_INPUT_SELECTOR } from "../src/dom/inputs.ts";
import { closestAcrossShadow, querySelectorAllDeep } from "../src/dom/tree.ts";
import { layOutFrame, page, type Page } from "./harness.ts";

let open: Array<Page> = [];
afterEach(() => {
  for (const item of open) item.close();
  open = [];
});

function load(html: string): Page {
  const p = page(html);
  open.push(p);
  return p;
}

/** A host element with an open shadow root holding `inner`. */
function shadowHost(p: Page, id: string, inner: string, attributes: Record<string, string> = {}): ShadowRoot {
  const host = p.doc.createElement("div");
  host.id = id;
  for (const [name, value] of Object.entries(attributes)) host.setAttribute(name, value);
  p.doc.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = inner;
  return root;
}

test("guards: withinGuard sees through open shadow roots (a web-component terminal)", () => {
  const p = load("");
  const root = shadowHost(p, "term", `<div class="xterm"><textarea id="input"></textarea></div>`, { "data-app-terminal": "" });
  const input = root.getElementById("input");
  assert.ok(input !== null);
  assert.equal(input.closest("[data-app-terminal]"), null, "plain closest stops at the shadow root");
  assert.equal(closestAcrossShadow(input, "[data-app-terminal]")?.id, "term");
  assert.equal(focusState([editableGuard, withinGuard("[data-app-terminal]")], input), "blocked");
});

test("guards: presenceGuard finds a modal rendered inside a shadow root", () => {
  const p = load("");
  const guard = presenceGuard(p.doc, MODAL_SELECTOR, "blocked");
  assert.equal(guard(null), undefined);
  const root = shadowHost(p, "portal", `<div></div>`);
  root.innerHTML = `<div role="dialog" aria-modal="true">Sure?</div>`;
  assert.equal(guard(null), "blocked");
});

test("gi picker: the last input used wins while it still shows", () => {
  const p = load(`
    <textarea id="big" data-rect="0,0,800,200"></textarea>
    <input id="small" data-rect="0,300,100,20">`);
  const small = p.doc.getElementById("small");
  const choice = { selector: TEXT_INPUT_SELECTOR, lastEditable: small, near: null };
  assert.equal(pickInput(p.doc, choice)?.id, "small");
  small?.setAttribute("data-rect", "0,0,0,0");
  assert.equal(pickInput(p.doc, choice)?.id, "big", "a hidden last input falls back to the biggest");
});

test("gi picker: the input in the pane you are in beats a bigger one elsewhere", () => {
  const p = load(`
    <section id="left" data-rect="0,0,400,800"><p id="here" data-rect="0,0,400,100">x</p><textarea id="mine" data-rect="0,600,300,50"></textarea></section>
    <section id="right" data-rect="400,0,600,800"><textarea id="theirs" data-rect="400,600,600,150"></textarea></section>`);
  const near = p.doc.getElementById("here");
  assert.equal(pickInput(p.doc, { selector: TEXT_INPUT_SELECTOR, lastEditable: null, near })?.id, "mine");
  assert.equal(pickInput(p.doc, { selector: TEXT_INPUT_SELECTOR, lastEditable: null, near: null })?.id, "theirs");
});

test("gi picker: a composer inside a shadow root counts, and its pane holds it", () => {
  const p = load(`
    <section id="left" data-rect="0,0,400,800"><p id="here" data-rect="0,0,400,100">x</p></section>
    <textarea id="plain" data-rect="400,600,600,150"></textarea>`);
  const host = p.doc.createElement("div");
  host.setAttribute("data-rect", "0,600,300,50");
  p.doc.getElementById("left")?.append(host);
  host.attachShadow({ mode: "open" }).innerHTML = `<textarea id="shadowed" data-rect="0,600,300,50"></textarea>`;
  const near = p.doc.getElementById("here");
  assert.equal(pickInput(p.doc, { selector: TEXT_INPUT_SELECTOR, lastEditable: null, near })?.id, "shadowed");
  const all = querySelectorAllDeep(p.doc, "textarea").map((element) => element.id);
  assert.deepEqual(all, ["plain", "shadowed"]);
});

test("guards: focusState stops at the first guard that settles it", () => {
  let asked = 0;
  const counting = () => {
    asked += 1;
    return undefined;
  };
  const p = load(`<textarea id="t"></textarea>`);
  const field = p.doc.getElementById("t");
  assert.equal(focusState([editableGuard, counting], field, "typing"), "typing");
  assert.equal(asked, 0, "a bare key in a text field needs no further guard");
  assert.equal(focusState([editableGuard, counting], field), "typing");
  assert.equal(asked, 1, "a chord asks every guard: one may block");
});

test("frames: a placement cache walks each document's frame chain once", () => {
  const p = load(`<iframe id="f" data-rect="100,100,300,200"></iframe>`);
  const frame = p.doc.getElementById("f") as HTMLIFrameElement;
  const inner = layOutFrame(frame);
  let walks = 0;
  const original = frame.getBoundingClientRect.bind(frame);
  frame.getBoundingClientRect = () => {
    walks += 1;
    return original();
  };
  const place = placementCache(p.doc);
  for (let index = 0; index < 50; index += 1) place(inner);
  assert.equal(walks, 1, "fifty labels in one frame, one frame-chain walk");
  assert.equal(place(inner)?.offsetX, 100);
});

test("gi picker: a host selector narrows the choice (bb: composers only)", () => {
  const p = load(`
    <input id="search" data-rect="0,0,900,40">
    <div class="composer"><textarea id="compose" data-rect="0,700,300,40"></textarea></div>`);
  const search = p.doc.getElementById("search");
  assert.equal(pickInput(p.doc, { selector: ".composer textarea", lastEditable: search, near: null })?.id, "compose");
});

test("gi picker: a preferred input wins over a bigger one, but never over the one used last", () => {
  const p = load(`
    <input id="search" data-rect="0,0,900,40">
    <div class="composer"><textarea id="compose" data-rect="0,700,300,40"></textarea></div>`);
  const prefer = ".composer textarea";
  assert.equal(pickInput(p.doc, { selector: TEXT_INPUT_SELECTOR, lastEditable: null, near: null, prefer })?.id, "compose");
  const search = p.doc.getElementById("search");
  assert.equal(pickInput(p.doc, { selector: TEXT_INPUT_SELECTOR, lastEditable: search, near: null, prefer })?.id, "search");
});

test("gi picker: an input under a dialog is not a candidate", () => {
  const p = load(`
    <textarea id="under" data-rect="0,0,600,200"></textarea>
    <div id="dialog" data-rect="0,0,800,400"><input id="name" data-rect="10,10,200,30"></div>`);
  assert.equal(pickInput(p.doc, { selector: TEXT_INPUT_SELECTOR, lastEditable: null, near: null })?.id, "name");
});
