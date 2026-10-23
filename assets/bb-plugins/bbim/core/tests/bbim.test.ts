// createBbim over a happy-dom page: keys, hints, guards, scrolling, disposal. Run: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { type Bbim, createBbim, type CreateBbimOptions } from "../src/dom/bbim.ts";
import { presenceGuard, withinGuard } from "../src/dom/focus.ts";
import { layOutFrame, page, type Page } from "./harness.ts";

const PAGE = `
  <main data-rect="0,0,1000,800">
    <a id="docs" href="https://docs.test/" data-rect="10,10,80,20">Docs</a>
    <button id="save" data-rect="10,50,80,30">Save</button>
    <button id="hidden" style="display:none" data-rect="10,90,80,30">Hidden</button>
    <button id="covered" data-rect="200,50,80,30">Covered</button>
    <div id="sheet" data-rect="190,40,120,60"></div>
    <button id="away" data-rect="10,2000,80,30">Off screen</button>
    <textarea id="composer" data-rect="10,700,600,60"></textarea>
    <div id="terminal" data-app-terminal data-rect="700,600,200,100" tabindex="0"></div>
    <div id="pane" style="overflow-y:auto" data-rect="400,100,500,400"><p data-rect="400,100,500,400">long</p></div>
  </main>`;

let current: { page: Page; bbim: Bbim } | undefined;

afterEach(() => {
  current?.bbim.dispose();
  current?.page.close();
  current = undefined;
});

function start(options: Omit<CreateBbimOptions, "window"> = {}) {
  const p = page(PAGE);
  const bbim = createBbim({ window: p.win, ...options });
  current = { page: p, bbim };
  return { p, bbim };
}

test("hints: only visible, uncovered, on-screen targets get labels", () => {
  const { p, bbim } = start();
  p.key("f");
  assert.equal(bbim.mode(), "hint");
  // docs, save, composer, the terminal's tabindex: not hidden, covered or off screen.
  assert.equal(p.labels().length, 4);
});

test("hints: typing a label activates its target; labels are case-insensitive", () => {
  const { p, bbim } = start();
  let clicked = "";
  p.doc.getElementById("save")?.addEventListener("click", () => {
    clicked = "save";
  });
  p.key("f");
  const labels = p.labels();
  // The save button is the second target from the top-left corner.
  const label = labels[1] ?? "";
  for (const char of label.toUpperCase()) p.key(char);
  assert.equal(clicked, "save");
  assert.equal(bbim.mode(), "normal");
  assert.deepEqual(p.labels(), []);
});

test("hints: typing narrows, Backspace widens, a wrong letter is ignored", () => {
  const { p } = start({ settings: { hintAlphabet: "ab" } });
  p.key("f");
  // Four targets over two letters: every label is two letters long.
  assert.deepEqual(p.labels(), ["aa", "ab", "ba", "bb"]);
  p.key("b");
  assert.deepEqual(p.labels(), ["ba", "bb"]);
  p.key("x");
  assert.deepEqual(p.labels(), ["ba", "bb"]);
  p.key("Backspace");
  assert.deepEqual(p.labels(), ["aa", "ab", "ba", "bb"]);
});

test("hints: Esc cancels and never reaches the app's own Escape handling", () => {
  const { p, bbim } = start();
  const reached: Array<string> = [];
  p.win.addEventListener("keydown", (event) => reached.push(event.key));
  p.key("f");
  p.key("Escape");
  assert.equal(bbim.mode(), "normal");
  assert.deepEqual(reached, []);
  p.key("Escape");
  assert.deepEqual(reached, ["Escape"], "outside hint mode Escape is the app's");
});

test("normal mode: digits and unbound keys pass through untouched", () => {
  const { p } = start();
  const reached: Array<string> = [];
  p.win.addEventListener("keydown", (event) => reached.push(event.key));
  for (const key of ["1", "9", "x", "Enter"]) p.key(key);
  assert.deepEqual(reached, ["1", "9", "x", "Enter"]);
});

test("guards: bare keys type into a text field, chords still work", () => {
  const { p, bbim } = start({ settings: { keys: { hintsNewTab: "<A-f>" } } });
  (p.doc.getElementById("composer") as HTMLTextAreaElement).focus();
  const typed = p.key("f");
  assert.equal(typed.defaultPrevented, false);
  assert.equal(bbim.mode(), "normal");
  const chord = p.key("ƒ", { altKey: true, code: "KeyF" });
  assert.equal(chord.defaultPrevented, true);
  assert.equal(bbim.mode(), "hint");
});

test("guards: a host guard blocks everything inside it", () => {
  const { p, bbim } = start({ hooks: { guards: [withinGuard("[data-app-terminal]")] } });
  (p.doc.getElementById("terminal") as HTMLElement).focus();
  p.key("f");
  assert.equal(bbim.mode(), "normal");
});

test("bareKeys off: single keys pass, chords work", () => {
  const { p, bbim } = start({ settings: { bareKeys: false, keys: { help: "<A-/>" } } });
  assert.equal(p.key("f").defaultPrevented, false);
  assert.equal(bbim.mode(), "normal");
  // Option+/ types ÷ on macOS; the chord is read from the physical key.
  p.key("÷", { altKey: true, code: "Slash" });
  assert.equal(bbim.mode(), "help");
});

test("scrolling: j scrolls the pane under the last click; gg goes to its top", () => {
  const { p } = start();
  const pane = p.doc.getElementById("pane") as HTMLElement;
  Object.defineProperty(pane, "scrollHeight", { value: 2000 });
  Object.defineProperty(pane, "clientHeight", { value: 400 });
  const calls: Array<string> = [];
  pane.scrollBy = ((options: ScrollToOptions) => calls.push(`by ${options.top}`)) as typeof pane.scrollBy;
  pane.scrollTo = ((options: ScrollToOptions) => calls.push(`to ${options.top}`)) as typeof pane.scrollTo;
  pane.firstElementChild?.dispatchEvent(new p.win.PointerEvent("pointerdown", { bubbles: true, composed: true }));
  p.key("j");
  p.key("d");
  p.key("g");
  p.key("g");
  assert.deepEqual(calls, ["by 70", "by 200", "to 0"]);
});

test("help: ? opens it, Esc closes it without reaching the app", () => {
  const { p, bbim } = start();
  const reached: Array<string> = [];
  p.win.addEventListener("keydown", (event) => reached.push(event.key));
  p.key("?");
  assert.equal(bbim.mode(), "help");
  const panel = p.overlayHost()?.shadowRoot?.querySelector(".help") as HTMLElement;
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /Scroll down/u);
  p.key("Escape");
  assert.equal(bbim.mode(), "normal");
  assert.equal(panel.hidden, true);
  assert.deepEqual(reached, []);
});

test("gi focuses the biggest text field", () => {
  const { p } = start();
  p.key("g");
  p.key("i");
  assert.equal(p.doc.activeElement?.id, "composer");
});

test("settings: conflicts and bad values show in help and do not break the rest", () => {
  const { p, bbim } = start();
  const problems = bbim.setSettings({ keys: { scrollDown: "g" }, scrollStep: "lots" });
  assert.deepEqual(
    problems.map((problem) => problem.field),
    ["scrollStep"],
  );
  p.key("?");
  const text = p.overlayHost()?.shadowRoot?.querySelector(".help")?.textContent ?? "";
  assert.match(text, /unreachable/u);
});

test("dispose: the overlay and every listener go away", () => {
  const { p, bbim } = start();
  p.key("f");
  bbim.dispose();
  assert.equal(p.overlayHost(), null);
  const reached: Array<string> = [];
  p.win.addEventListener("keydown", (event) => reached.push(event.key));
  p.key("f");
  p.key("Escape");
  assert.deepEqual(reached, ["f", "Escape"]);
});

test("sequences: a pending g never swallows a key typed after focus moves to a field", () => {
  const { p, bbim } = start();
  p.key("g");
  (p.doc.getElementById("composer") as HTMLTextAreaElement).focus();
  const typed = p.key("i");
  assert.equal(typed.defaultPrevented, false, "gi must not fire from a stale g");
  assert.equal(bbim.mode(), "normal");
});

test("sequences: a plain-key sequence stops when typing starts without a focus change", () => {
  const { p, bbim: plain } = start();
  plain.dispose();
  const bbim = createBbim({ window: p.win, hooks: { guards: [presenceGuard(p.doc, '[role="menu"]', "typing")] } });
  current = { page: p, bbim };
  p.key("g");
  // An open menu (typeahead) appears while `g` is pending; focus stays put.
  const menu = p.doc.createElement("div");
  menu.setAttribute("role", "menu");
  p.doc.body.append(menu);
  assert.equal(p.key("g").defaultPrevented, false, "gg must not complete into the menu's typeahead");
});

test("sequences: a pending prefix older than the timeout is forgotten before the next key", async () => {
  const { p } = start({ settings: { sequenceTimeoutMs: 200 } });
  const pane = p.doc.getElementById("pane") as HTMLElement;
  Object.defineProperty(pane, "scrollHeight", { value: 2000 });
  Object.defineProperty(pane, "clientHeight", { value: 400 });
  const calls: Array<string> = [];
  pane.scrollTo = ((options: ScrollToOptions) => calls.push(`to ${options.top}`)) as typeof pane.scrollTo;
  pane.firstElementChild?.dispatchEvent(new p.win.PointerEvent("pointerdown", { bubbles: true, composed: true }));
  p.key("g");
  await new Promise((resolve) => setTimeout(resolve, 260));
  p.key("g");
  assert.deepEqual(calls, [], "two g's 260 ms apart are not gg");
});

test("hint mode: held keys and IME composition never type a label", () => {
  const { p, bbim } = start({ settings: { hintAlphabet: "ab" } });
  p.key("f");
  assert.equal(p.key("b", { repeat: true }).defaultPrevented, true);
  assert.deepEqual(p.labels(), ["aa", "ab", "ba", "bb"], "a repeat is swallowed, not typed");
  assert.equal(p.key("b", { isComposing: true }).defaultPrevented, true);
  assert.equal(p.key("Process").defaultPrevented, true);
  // oxlint-disable-next-line typescript/no-deprecated -- Safari marks IME keys only by keyCode 229.
  assert.equal(p.key("a", { keyCode: 229 }).defaultPrevented, true);
  assert.deepEqual(p.labels(), ["aa", "ab", "ba", "bb"]);
  assert.equal(bbim.mode(), "hint");
});

test("normal mode: IME keys pass through untouched", () => {
  const { p, bbim } = start();
  assert.equal(p.key("f", { isComposing: true }).defaultPrevented, false);
  // oxlint-disable-next-line typescript/no-deprecated -- Safari marks IME keys only by keyCode 229.
  assert.equal(p.key("f", { keyCode: 229 }).defaultPrevented, false);
  assert.equal(bbim.mode(), "normal");
});

test("hint mode: Caps Lock does not turn f into the new-tab F", () => {
  const { p, bbim } = start({ settings: { keys: { hintsNewTab: "" } } });
  p.key("F");
  assert.equal(bbim.mode(), "hint", "F without shift is f");
});

test("hints: focus moving into a frame ends hint mode", async () => {
  const { p, bbim } = start();
  const frame = p.doc.createElement("iframe");
  frame.setAttribute("data-rect", "600,100,200,200");
  p.doc.body.append(frame);
  p.key("f");
  assert.equal(bbim.mode(), "hint");
  Object.defineProperty(p.doc, "activeElement", { value: frame, configurable: true });
  p.win.dispatchEvent(new p.win.Event("blur"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(bbim.mode(), "normal");
});

test("hints: a click inside a same-origin frame ends hint mode", () => {
  const { p, bbim } = start();
  const frame = p.doc.createElement("iframe");
  frame.setAttribute("data-rect", "600,100,200,200");
  p.doc.body.append(frame);
  const inner = layOutFrame(frame);
  assert.ok(frame.contentWindow !== null);
  p.key("f");
  assert.equal(bbim.mode(), "hint");
  inner.body.dispatchEvent(new (frame.contentWindow as typeof p.win).PointerEvent("pointerdown", { bubbles: true, composed: true }));
  assert.equal(bbim.mode(), "normal");
});

test("hints: a target that left the page relabels instead of doing nothing", () => {
  const { p, bbim } = start();
  p.key("f");
  const before = p.labels().length;
  const save = p.labels()[1] ?? "";
  p.doc.getElementById("save")?.remove();
  for (const char of save) p.key(char);
  assert.equal(bbim.mode(), "hint", "hints come back, collected afresh");
  assert.equal(p.labels().length, before - 1);
});

test("dispose: aborting the signal disposes", () => {
  const controller = new AbortController();
  const { p } = start({ signal: controller.signal });
  assert.notEqual(p.overlayHost(), null);
  controller.abort();
  assert.equal(p.overlayHost(), null);
});
