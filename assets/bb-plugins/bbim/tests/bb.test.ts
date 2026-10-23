// The bb adapter over a happy-dom page shaped like bb: mounting, guards, gi.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { commandAvailable, mountBbim, runAction, syncSettings } from "../adapter/bb.ts";
import { hostSettings } from "../adapter/settings.ts";
import { page, type Page } from "../core/tests/harness.ts";

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
