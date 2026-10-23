// The bb adapter over a happy-dom page shaped like bb: mounting, guards, gi.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { commandAvailable, mountBbim, runAction } from "../adapter/bb.ts";
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

test("guards: a terminal built as a web component keeps alt+f (shadow root)", () => {
  const { p } = mounted();
  const host = p.doc.createElement("div");
  host.setAttribute("data-app-terminal", "");
  p.doc.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<textarea id="xterm"></textarea>`;
  assert.equal(commandAvailable(), true);
  root.getElementById("xterm")?.focus();
  assert.equal(commandAvailable(), false);
});

test("gi: labels every input; the composer of the pane you are in takes the first label and Enter", () => {
  const { p } = mounted();
  p.doc.getElementById("left-text")?.dispatchEvent(new p.win.PointerEvent("pointerdown", { bubbles: true, composed: true }));
  runAction("focusInput");
  assert.equal(p.labels().length, 3, "both composers and the search box");
  p.key("Enter");
  assert.equal(p.doc.activeElement?.id, "left-composer", "the bigger search box does not win the default");
});
