// The bb adapter over a happy-dom page shaped like bb: mounting, guards, gi.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ACTIVE_ATTRIBUTE, attachBrowserPage, commandAvailable, mountBbim, runAction, syncSettings } from "../adapter/bb.ts";
import { hostSettings } from "../adapter/settings.ts";
import { bbPageEvaluate, page, type Page } from "../core/tests/harness.ts";

const BB = `
  <div class="pane" data-rect="0,0,500,800">
    <p id="left-text" data-rect="0,0,500,100">thread</p>
    <div class="chat-prompt-box"><textarea id="left-composer" data-rect="10,700,300,40"></textarea></div>
  </div>
  <div class="pane" data-rect="500,0,500,800">
    <div class="chat-prompt-box"><textarea id="right-composer" data-rect="510,600,480,150"></textarea></div>
  </div>
  <input id="search" data-rect="0,0,1000,30">`;

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const step of cleanup) step();
  cleanup = [];
  syncSettings({});
});

function mounted(): { p: Page; controller: AbortController } {
  const p = page(BB);
  const controller = new AbortController();
  mountBbim(controller.signal, p.win);
  cleanup.push(() => {
    controller.abort();
    p.close();
  });
  return { p, controller };
}

test("mountBbim: a second mount disposes the first, so one engine answers keys", () => {
  const { p } = mounted();
  mountBbim(new AbortController().signal, p.win);
  assert.equal(p.doc.querySelectorAll("[data-bbim-overlay]").length, 1);
  p.key("f");
  assert.ok(p.labels().length > 0);
});

function terminal(p: Page): HTMLTextAreaElement {
  const host = p.doc.createElement("div");
  host.setAttribute("data-app-terminal", "");
  host.setAttribute("data-rect", "0,400,1000,300");
  p.doc.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<textarea id="xterm" data-rect="0,400,10,10"></textarea>`;
  return root.getElementById("xterm") as HTMLTextAreaElement;
}

test("terminal: the chords work there by default; chordsInTerminal off gives them back (shadow root)", () => {
  const { p } = mounted();
  const xterm = terminal(p);
  xterm.focus();
  assert.equal(commandAvailable(), true, "chordsInTerminal is on by default");
  syncSettings({}, { chordsInTerminal: false });
  assert.equal(commandAvailable(), false, "off: alt+f is the shell's forward-word again");
  syncSettings({}, { chordsInTerminal: true });
  assert.equal(commandAvailable(), true);
});

test("terminal: bare keys stay off; hints from a terminal swallow keys and Esc leaves focus in it", () => {
  const { p } = mounted();
  const xterm = terminal(p);
  const shell: Array<string> = [];
  xterm.addEventListener("keydown", (event) => shell.push(event.key));
  // Keys land on the terminal's own textarea, inside its shadow root.
  const type = (key: string) => {
    const event = new p.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true });
    xterm.dispatchEvent(event);
    return event;
  };
  xterm.focus();
  const bare = type("f");
  assert.equal(bare.defaultPrevented, false, "f is typed into the shell");
  assert.deepEqual(p.labels(), []);
  runAction("hints");
  assert.ok(p.labels().length > 0, "alt+f (the bb command) shows hints from the terminal");
  type("z");
  type("Escape");
  assert.deepEqual(p.labels(), []);
  assert.deepEqual(shell, ["f"], "nothing typed in hint mode reached the shell, Esc included");
  assert.equal((xterm.getRootNode() as ShadowRoot).activeElement, xterm, "the terminal keeps focus and its caret");
});

/** bb's Browser view: its toolbar (where the plugin's toolbar action renders) and the box the native page covers. */
function browserTab(p: Page): Element {
  const browser = p.doc.createElement("div");
  browser.setAttribute("data-app-browser", "");
  browser.setAttribute("data-rect", "500,0,500,800");
  browser.innerHTML = `<div class="toolbar" data-rect="500,0,500,40"><span id="anchor"></span></div><div id="viewport" data-rect="500,40,500,760"></div>`;
  p.doc.body.append(browser);
  return browser.querySelector("#anchor") as Element;
}

/** A fake `experimental_page`: bb's evaluation contract (bbPageEvaluate) over a happy-dom window standing in for the tab. */
function fakeExperimentalPage(site: Page) {
  const listeners = new Set<(data: unknown) => void>();
  const evaluate = bbPageEvaluate(site.win, (data) => listeners.forEach((listener) => listener(data)));
  const worlds: Array<string | undefined> = [];
  return {
    evaluate: (expression: string, options?: { readonly world?: "isolated" | "main" }) => {
      worlds.push(options?.world);
      return evaluate(expression, options?.world);
    },
    onMessage: (listener: (data: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    worlds,
  };
}

test("browser tab: alt+f (the bb command) labels the tab's page inside it; a pick clicks there", async () => {
  const { p } = mounted();
  const site = page(`<button id="buy" data-rect="10,10,80,30">Buy</button>`);
  cleanup.push(() => site.close());
  const tab = fakeExperimentalPage(site);
  const detach = attachBrowserPage(browserTab(p), tab);
  cleanup.push(detach);
  let bought = 0;
  site.doc.getElementById("buy")?.addEventListener("click", () => (bought += 1));
  p.doc.getElementById("search")?.focus();
  assert.equal(commandAvailable(), true);
  runAction("hints");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const inPage = site.labels();
  assert.equal(inPage.length, 1, "the page draws its own label");
  assert.ok(tab.worlds.every((world) => world === "isolated"), "only ever the isolated world");
  for (const char of inPage[0] ?? "") p.key(char);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(bought, 1);
});

test("browser tab: outside the desktop app (no experimental_page) the tab quietly gets no hints", () => {
  const { p } = mounted();
  const detach = attachBrowserPage(browserTab(p), null);
  detach();
  runAction("hints");
  assert.ok(p.labels().length > 0, "the rest of bb still gets hints");
});

test("browser tab: the address bar keeps the chords, not the bare keys", () => {
  const { p } = mounted();
  const anchor = browserTab(p);
  const address = p.doc.createElement("input");
  anchor.parentElement?.append(address);
  address.focus();
  assert.equal(commandAvailable(), true);
  assert.equal(p.key("f").defaultPrevented, false, "f types into the address bar");
});

test("settings: chordsInTerminal decodes, a bad stored value is its default", () => {
  assert.deepEqual(hostSettings({}), { chordsInTerminal: true });
  assert.deepEqual(hostSettings({ chordsInTerminal: false }), { chordsInTerminal: false });
  assert.deepEqual(hostSettings({ chordsInTerminal: "no" }), { chordsInTerminal: true });
});

test("gi: labels every input; the composer of the pane you are in takes the first label and Enter", () => {
  const { p } = mounted();
  p.doc.getElementById("left-text")?.dispatchEvent(new p.win.PointerEvent("pointerdown", { bubbles: true, composed: true }));
  runAction("focusInput");
  assert.equal(p.labels().length, 3, "both composers and the search box");
  p.key("Enter");
  assert.equal(p.doc.activeElement?.id, "left-composer", "the bigger search box does not win the default");
});

test("data-bbim-active: on <html> while hints or a picker (gi) show, gone when they end", () => {
  const { p } = mounted();
  const active = () => p.doc.documentElement.hasAttribute(ACTIVE_ATTRIBUTE);
  assert.equal(active(), false);
  runAction("hints");
  assert.equal(active(), true, "hints are up");
  p.key("Escape");
  assert.equal(active(), false, "Esc ends hints");
  runAction("focusInput");
  assert.equal(active(), true, "gi's input picker is a pick session too");
  p.key("Escape");
  assert.equal(active(), false);
  runAction("help");
  assert.equal(active(), false, "help places no labels on bb's elements");
});

test("data-bbim-active: unmounting mid-hints leaves no stale mark", () => {
  const { p, controller } = mounted();
  runAction("hints");
  assert.equal(p.doc.documentElement.hasAttribute(ACTIVE_ATTRIBUTE), true);
  controller.abort();
  assert.equal(p.doc.documentElement.hasAttribute(ACTIVE_ATTRIBUTE), false);
});
