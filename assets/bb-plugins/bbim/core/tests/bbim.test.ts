// createBbim over a happy-dom page: keys, hints, guards, scrolling, disposal. Run: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { type Bbim, createBbim, type CreateBbimOptions } from "../src/dom/bbim.ts";
import { BRIDGE_PROTOCOL } from "../src/domain/protocol.ts";
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

/** A thread-panel tab (role=tab) holding a close button that shows only on hover. */
const TABS = `
  <main data-rect="0,0,1000,800">
    <div role="tab" id="tab" data-rect="10,10,160,28">Thread one
      <button id="close" aria-label="Close" style="opacity:0" data-rect="150,16,16,16">×</button>
    </div>
    <div class="row" style="opacity:0.02"><button id="row-menu" data-rect="10,60,20,20">…</button></div>
    <button id="hidden" style="visibility:hidden" data-rect="10,100,40,20">Hidden</button>
    <button id="save" data-rect="400,400,80,30">Save</button>
  </main>`;

test("hints: a tab containing a faded × button: both labelled, × after the visible ones", () => {
  const p = page(TABS);
  const bbim = createBbim({ window: p.win });
  current = { page: p, bbim };
  let closed = 0;
  p.doc.getElementById("close")?.addEventListener("click", () => {
    closed += 1;
  });
  p.key("f");
  const views = [...(p.doc.querySelector("[data-bbim-overlay]")?.shadowRoot?.querySelectorAll(".hint") ?? [])];
  // tab, save; then the faded close button and the faded row menu (an ancestor's opacity counts).
  assert.equal(views.length, 4, "visibility:hidden stays out; faded controls stay in");
  const faded = views.filter((view) => view.classList.contains("faded"));
  assert.equal(faded.length, 2);
  assert.ok(views.indexOf(faded[0] as Element) >= 2, "faded labels come after every visible one");
  const labels = p.labels();
  const visibleLongest = Math.max(...labels.slice(0, 2).map((label) => label.length));
  assert.ok(labels.slice(2).every((label) => label.length >= visibleLongest), "no faded target takes a shorter label");
  // Pick the faded labels until the close button fires: it is clicked as is, no hover needed.
  for (const label of labels.slice(2)) {
    if (closed > 0) break;
    if (bbim.mode() !== "hint") p.key("f");
    for (const char of label) p.key(char);
  }
  assert.equal(closed, 1);
});

test("settings: fadedTargets hide leaves hover-only controls out", () => {
  const p = page(TABS);
  const bbim = createBbim({ window: p.win, settings: { fadedTargets: "hide" } });
  current = { page: p, bbim };
  p.key("f");
  assert.equal(p.labels().length, 2);
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

test("guards: ordinary typing never runs the host guards", () => {
  let asked = 0;
  const counting = () => {
    asked += 1;
    return undefined;
  };
  const { p } = start({ hooks: { guards: [counting] } });
  for (const key of ["1", "9", "x", "Enter"]) p.key(key);
  assert.equal(asked, 0, "unbound keys cost no guard");
  (p.doc.getElementById("composer") as HTMLTextAreaElement).focus();
  for (const key of ["f", "j", "g", "a"]) assert.equal(p.key(key).defaultPrevented, false);
  assert.equal(asked, 0, "bound keys in a text field stop at the editable check");
  p.doc.body.focus();
  (p.doc.activeElement as HTMLElement | null)?.blur();
  p.key("j");
  assert.equal(asked, 1, "a bound key outside a field asks each guard once");
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

/** Make `element` a vertical scroll surface (happy-dom lays nothing out) and record its scroll calls. */
function scrollable(element: HTMLElement, calls: Array<string>) {
  element.style.overflowY = "auto";
  Object.defineProperty(element, "scrollHeight", { value: 2000 });
  Object.defineProperty(element, "clientHeight", { value: 300 });
  element.scrollBy = ((options: ScrollToOptions) => calls.push(`${element.id} by ${options.top}`)) as typeof element.scrollBy;
  element.scrollTo = ((options: ScrollToOptions) => calls.push(`${element.id} to ${options.top}`)) as typeof element.scrollTo;
}

const PANES = `
  <main data-rect="0,0,1000,800">
    <nav id="sidebar" data-rect="0,0,200,800"><a id="row" href="#r" data-rect="10,10,100,20">Row</a></nav>
    <section id="transcript" data-rect="220,0,560,800"><p id="line" data-rect="220,10,500,20">hello</p></section>
    <div id="tiny" data-rect="800,10,20,20"></div>
  </main>`;

test("scroll picker: gs outlines every scroll surface; the picked one is what j/k/d/u/gg/G move", () => {
  const p = page(PANES);
  const bbim = createBbim({ window: p.win });
  current = { page: p, bbim };
  const calls: Array<string> = [];
  for (const id of ["sidebar", "transcript", "tiny"]) scrollable(p.doc.getElementById(id) as HTMLElement, calls);
  p.doc.getElementById("line")?.dispatchEvent(new p.win.PointerEvent("pointerdown", { bubbles: true, composed: true }));
  p.key("g");
  p.key("s");
  assert.equal(bbim.mode(), "hint");
  const labels = p.labels();
  assert.equal(labels.length, 2, "two panes; a 20 px box is no surface");
  const surfaces = p.overlayHost()?.shadowRoot?.querySelectorAll(".surface") ?? [];
  assert.equal(surfaces.length, 2, "each surface is outlined");
  // Labels go to the region first: the transcript (last click) gets the first one.
  const sidebarLabel = labels[1] ?? "";
  for (const char of sidebarLabel) p.key(char);
  assert.equal(bbim.mode(), "normal");
  p.key("j");
  p.key("G", { shiftKey: true });
  assert.deepEqual(calls, ["sidebar by 70", "sidebar to 2000"], "the picked pane scrolls, not the one clicked");
  p.doc.getElementById("line")?.dispatchEvent(new p.win.PointerEvent("pointerdown", { bubbles: true, composed: true }));
  p.key("j");
  assert.equal(calls.at(-1), "transcript by 70", "a click elsewhere hands scrolling back");
});

test("scroll picker: with one surface, gs selects it without labels", () => {
  const p = page(PANES);
  const bbim = createBbim({ window: p.win, settings: { keys: { pickScroll: "<A-s>" } } });
  current = { page: p, bbim };
  const calls: Array<string> = [];
  scrollable(p.doc.getElementById("sidebar") as HTMLElement, calls);
  p.key("ß", { altKey: true, code: "KeyS" });
  assert.equal(bbim.mode(), "normal");
  assert.deepEqual(p.labels(), []);
  assert.equal(p.overlayHost()?.shadowRoot?.querySelectorAll(".flash").length, 1, "the pane flashes so you see which");
  p.key("j");
  assert.deepEqual(calls, ["sidebar by 70"]);
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

const INPUTS = `
  <main data-rect="0,0,1000,800">
    <input id="search" type="search" data-rect="10,10,300,30">
    <button id="go" data-rect="320,10,60,30">Go</button>
    <input id="setting" data-rect="500,100,200,30">
    <textarea id="gone" style="display:none" data-rect="10,300,300,60"></textarea>
    <div class="composer"><textarea id="compose" data-rect="10,700,600,60"></textarea></div>
  </main>`;

function inputsPage(options: Omit<CreateBbimOptions, "window"> = {}) {
  const p = page(INPUTS);
  const bbim = createBbim({ window: p.win, ...options });
  current = { page: p, bbim };
  return { p, bbim };
}

test("gi with several inputs: labels the inputs only; the last one used gets the first label", () => {
  const { p, bbim } = inputsPage();
  const search = p.doc.getElementById("search") as HTMLInputElement;
  search.focus();
  search.blur();
  p.key("g");
  p.key("i");
  assert.equal(bbim.mode(), "hint");
  const labels = p.labels();
  assert.equal(labels.length, 3, "search, setting and composer; not the button or the hidden field");
  assert.ok(labels.every((label) => label.length === 1));
  for (const char of labels[0] ?? "") p.key(char);
  assert.equal(bbim.mode(), "normal");
  assert.equal(p.doc.activeElement?.id, "search", "the first label is the input used last");
});

test("gi + Enter focuses the input used last, as gi alone did before", () => {
  const { p, bbim } = inputsPage();
  const setting = p.doc.getElementById("setting") as HTMLInputElement;
  setting.focus();
  setting.blur();
  p.key("g");
  p.key("i");
  const enter = p.key("Enter");
  assert.equal(enter.defaultPrevented, true, "Enter never reaches the page while labels are up");
  assert.equal(bbim.mode(), "normal");
  assert.equal(p.doc.activeElement?.id, "setting");
});

test("gi: with nothing used yet, the host's preferred input (bb: the composer) takes the first label", () => {
  const { p } = inputsPage({ preferInput: ".composer textarea" });
  p.key("g");
  p.key("i");
  p.key("Enter");
  assert.equal(p.doc.activeElement?.id, "compose");
});

test("gi: a typed label picks any input, one in a same-origin frame too", () => {
  const { p, bbim } = inputsPage();
  const frame = p.doc.createElement("iframe");
  frame.setAttribute("data-rect", "500,300,400,200");
  p.doc.querySelector("main")?.append(frame);
  const inner = layOutFrame(frame);
  inner.body.innerHTML = `<input id="framed" data-rect="10,10,200,30">`;
  p.key("g");
  p.key("i");
  assert.equal(p.labels().length, 4, "the frame's input joins the page's");
  // The biggest page input (the composer) leads; the rest go by place, the framed one last.
  for (const char of p.labels()[3] ?? "") p.key(char);
  assert.equal(bbim.mode(), "normal");
  assert.equal(inner.activeElement?.id, "framed");
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

/** A cross-origin frame: its document throws, its window records what it is sent. */
function opaqueFrame(p: Page, rect: string) {
  const frame = p.doc.createElement("iframe");
  frame.setAttribute("data-rect", rect);
  p.doc.body.append(frame);
  const box = frame.getBoundingClientRect();
  Object.defineProperty(frame, "clientWidth", { value: box.width });
  Object.defineProperty(frame, "clientHeight", { value: box.height });
  Object.defineProperty(frame, "contentDocument", {
    get: () => {
      throw new Error("cross-origin");
    },
  });
  const sent: Array<{ type: string; requestId?: string; active?: boolean }> = [];
  const child = { postMessage: (message: { type: string }) => sent.push(message) };
  Object.defineProperty(frame, "contentWindow", { value: child });
  return { frame, child, sent };
}

function fromFrame(p: Page, source: unknown, data: unknown) {
  p.win.dispatchEvent(new p.win.MessageEvent("message", { data, origin: "https://frame.test", source: source as Window }));
}

const key = (char: string) => ({
  bbim: BRIDGE_PROTOCOL,
  type: "key",
  key: char,
  code: "",
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
});

/** Hints up with one focused bridge frame; `answer` makes it reply with one target. */
function withFocusedFrame(options: Omit<CreateBbimOptions, "window"> = {}) {
  const { p, bbim } = start({ settings: { hintAlphabet: "ab" }, bridgeTimeoutMs: 200, ...options });
  const focused = opaqueFrame(p, "600,100,200,200");
  Object.defineProperty(p.doc, "activeElement", { value: focused.frame, configurable: true });
  bbim.run("hints");
  const requestId = focused.sent.find((message) => message.type === "collect")?.requestId ?? "";
  return {
    p,
    bbim,
    focused,
    answer: async () => {
      fromFrame(p, focused.child, {
        bbim: BRIDGE_PROTOCOL,
        type: "targets",
        requestId,
        targets: [{ id: 7, kind: "button", left: 10, top: 10, width: 40, height: 20 }],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("hints: a target that moved or got covered relabels instead of being clicked", () => {
  const { p, bbim } = start();
  let clicked = 0;
  const save = p.doc.getElementById("save");
  save?.addEventListener("click", () => {
    clicked += 1;
  });
  p.key("f");
  const moved = p.labels()[1] ?? "";
  save?.setAttribute("data-rect", "10,300,80,30");
  for (const char of moved) p.key(char);
  assert.equal(clicked, 0, "a moved target is not clicked where it no longer is");
  assert.equal(bbim.mode(), "hint", "hints come back, collected afresh");
  p.key("Escape");
  const cover = p.doc.createElement("div");
  cover.setAttribute("data-rect", "0,290,200,60");
  p.doc.body.append(cover);
  p.key("f");
  const labels = p.labels();
  // Covered now: it gets no label at all; uncover it to see it labeled again.
  cover.remove();
  p.key("Escape");
  p.key("f");
  assert.equal(p.labels().length, labels.length + 1);
  const label = p.labels()[1] ?? "";
  p.doc.body.append(cover);
  for (const char of label) p.key(char);
  assert.equal(clicked, 0, "a target covered since its label showed is not clicked");
  assert.equal(bbim.mode(), "hint");
});

test("bridge frames: the page's labels show at once and a slow frame's join when it answers", async () => {
  const { p, bbim } = start();
  const slow = opaqueFrame(p, "600,100,200,200");
  bbim.run("hints");
  const local = p.labels().length;
  assert.equal(local, 4, "the page's own targets do not wait for frames");
  await later(300);
  const requestId = slow.sent.find((message) => message.type === "collect")?.requestId ?? "";
  fromFrame(p, slow.child, {
    bbim: BRIDGE_PROTOCOL,
    type: "targets",
    requestId,
    targets: [{ id: 3, kind: "button", left: 10, top: 10, width: 40, height: 20 }],
  });
  await later(10);
  assert.equal(p.labels().length, local + 1, "a frame answering after 300 ms still gets its label");
});

test("bridge frames: labels never change under a half-typed one", async () => {
  const { p, bbim } = start({ settings: { hintAlphabet: "ab" } });
  const slow = opaqueFrame(p, "600,100,200,200");
  bbim.run("hints");
  const first = p.labels()[0]?.[0] ?? "a";
  p.key(first);
  const narrowed = p.labels();
  const requestId = slow.sent.find((message) => message.type === "collect")?.requestId ?? "";
  fromFrame(p, slow.child, {
    bbim: BRIDGE_PROTOCOL,
    type: "targets",
    requestId,
    targets: [{ id: 3, kind: "button", left: 10, top: 10, width: 40, height: 20 }],
  });
  await later(10);
  assert.deepEqual(p.labels(), narrowed);
  assert.equal(bbim.mode(), "hint");
});

test("bridge frames: with nothing on the page, hints wait for the frames", async () => {
  const { p, bbim } = start({ selectors: ["#nothing-here"], bridgeTimeoutMs: 200 });
  const slow = opaqueFrame(p, "600,100,200,200");
  bbim.run("hints");
  assert.equal(bbim.mode(), "hint", "frames may still answer");
  const requestId = slow.sent.find((message) => message.type === "collect")?.requestId ?? "";
  fromFrame(p, slow.child, {
    bbim: BRIDGE_PROTOCOL,
    type: "targets",
    requestId,
    targets: [{ id: 3, kind: "button", left: 10, top: 10, width: 40, height: 20 }],
  });
  await later(10);
  assert.equal(p.labels().length, 1);
  p.key("Escape");
  bbim.run("hints");
  await later(250);
  assert.equal(bbim.mode(), "normal", "no target anywhere once the frames had their time");
});

test("bridge frames: only the focused frame forwards keys, and its keys pick only its own targets", async () => {
  const { p, bbim } = start({ settings: { hintAlphabet: "ab" }, bridgeTimeoutMs: 200 });
  const focused = opaqueFrame(p, "600,100,200,200");
  const other = opaqueFrame(p, "600,400,200,150");
  let saved = false;
  p.doc.getElementById("save")?.addEventListener("click", () => {
    saved = true;
  });
  Object.defineProperty(p.doc, "activeElement", { value: focused.frame, configurable: true });
  bbim.run("hints");
  assert.deepEqual(
    focused.sent.map((message) => message.type).toSorted(),
    ["collect", "mode"],
  );
  assert.deepEqual(
    other.sent.map((message) => message.type),
    ["collect"],
    "the unfocused frame is never told to forward keys",
  );
  const requestId = focused.sent.find((message) => message.type === "collect")?.requestId ?? "";
  const reply = { bbim: BRIDGE_PROTOCOL, type: "targets", requestId, targets: [{ id: 7, kind: "button", left: 10, top: 10, width: 40, height: 20 }] };
  fromFrame(p, focused.child, reply);
  fromFrame(p, other.child, { ...reply, targets: [{ id: 9, kind: "button", left: 10, top: 10, width: 40, height: 20 }] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const labels = p.labels();
  assert.ok(labels.length >= 2);
  fromFrame(p, other.child, key(labels[0]?.[0] ?? "a"));
  assert.deepEqual(p.labels(), labels, "keys from the unfocused frame are not heard");
  for (const label of labels) {
    for (const char of label) fromFrame(p, focused.child, key(char));
    if (bbim.mode() === "normal") break;
  }
  assert.equal(saved, false, "a frame's keys cannot click the page's own controls");
  assert.deepEqual(
    focused.sent.filter((message) => message.type === "activate").map((message) => (message as { targetId?: number }).targetId),
    [7],
  );
  assert.equal(other.sent.filter((message) => message.type === "activate").length, 0);
  assert.ok(focused.sent.some((message) => message.type === "mode" && message.active === false), "leaving hint mode turns forwarding off");
});

test("bridge frames: a frame's keys cannot narrow or take back the page's typed prefix", async () => {
  const { p, focused, answer } = withFocusedFrame();
  await answer();
  const labels = p.labels();
  const frameLabel = labels.at(-1) ?? "";
  // The page types the first letter of a label that is not the frame's.
  const pageLabel = labels.find((label) => label[0] !== frameLabel[0]) ?? "";
  p.key(pageLabel[0] ?? "a");
  const narrowed = p.labels();
  assert.ok(narrowed.length < labels.length);
  fromFrame(p, focused.child, key(frameLabel[1] ?? "b"));
  fromFrame(p, focused.child, key("Backspace"));
  assert.deepEqual(p.labels(), narrowed, "the frame's keys changed nothing");
});

test("bridge frames: keys and target replies have separate budgets", async () => {
  const { p, focused, answer } = withFocusedFrame();
  for (let index = 0; index < 300; index += 1) fromFrame(p, focused.child, key("x"));
  await answer();
  assert.ok(p.labels().length > 0, "a frame that typed a lot still gets its labels");
});

test("bridge frames: the frame leaving (a click in it, a lapse) ends hint mode", async () => {
  const { p, bbim, focused, answer } = withFocusedFrame();
  await answer();
  assert.equal(bbim.mode(), "hint");
  fromFrame(p, focused.child, { bbim: BRIDGE_PROTOCOL, type: "leave", reason: "pointer" });
  assert.equal(bbim.mode(), "normal");
});

test("bridge frames: a heartbeat that comes too late ends hint mode with the frame", async () => {
  const clock = { offset: 0 };
  const { p, bbim, answer } = withFocusedFrame();
  await answer();
  const real = p.win.performance.now.bind(p.win.performance);
  Object.defineProperty(p.win.performance, "now", { value: () => real() + clock.offset, configurable: true });
  clock.offset = 10_000; // the tab slept through several renewals
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(bbim.mode(), "normal");
});

test("dispose: aborting the signal disposes", () => {
  const controller = new AbortController();
  const { p } = start({ signal: controller.signal });
  assert.notEqual(p.overlayHost(), null);
  controller.abort();
  assert.equal(p.overlayHost(), null);
});
