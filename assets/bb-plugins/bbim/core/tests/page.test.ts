// A native page (bb's desktop Browser tab): a page shown in a native view over
// the host's window, reached by script. The fake below runs the real built
// page bridge (bridge/bbim-page.ts) in its own happy-dom window, as bb's
// `experimental_page.evaluate` would in the page's isolated world. Run: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createBbim, type Bbim } from "../src/dom/bbim.ts";
import type { PageView } from "../src/dom/bridge-client.ts";
import { pageRequest } from "../src/bridge/page-request.ts";
import { layOutFrame, page, type Page } from "./harness.ts";

const HOST = `
  <main data-rect="0,0,1000,800">
    <button id="send" data-rect="10,10,80,30">Send</button>
    <div data-app-browser data-rect="400,0,600,800"><div id="viewport" data-rect="400,40,600,760"></div></div>
  </main>`;

const SITE = `
  <a id="docs" href="https://docs.test/" data-rect="10,10,80,20">Docs</a>
  <button id="buy" data-rect="10,100,80,30">Buy</button>`;

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const step of cleanup) step();
  cleanup = [];
});

/** What bb's experimental_page does, over a happy-dom window standing in for the tab. */
function fakeTab(site: Page) {
  const listeners = new Set<(data: unknown) => void>();
  // The isolated world's `bb`: what the page bridge posts goes to the host's listeners.
  Object.defineProperty(site.win, "bb", {
    value: { postMessage: (data: unknown) => { for (const listener of listeners) listener(JSON.parse(JSON.stringify(data))); } },
    configurable: true,
  });
  let evaluations = 0;
  return {
    evaluate: (expression: string) => {
      evaluations += 1;
      return Promise.resolve(site.win.eval(expression) as unknown);
    },
    onMessage: (listener: (data: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    evaluations: () => evaluations,
  };
}

/** A person's keydown in the tab: the browser marks it trusted, which a page's own script cannot. */
function typeIn(site: Page, key: string, init: Partial<KeyboardEventInit> & { code?: string } = {}, trusted = true): KeyboardEvent {
  const event = new site.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  Object.defineProperty(event, "isTrusted", { value: trusted });
  (site.doc.activeElement ?? site.doc.body).dispatchEvent(event);
  return event;
}

function setUp(): { host: Page; site: Page; bbim: Bbim; detach: () => void; pageLabels: () => Array<string> } {
  const host = page(HOST);
  const site = page(SITE);
  const bbim = createBbim({
    window: host.win,
    settings: { hintAlphabet: "sadfjkl" },
    bridgeTimeoutMs: 200,
    hostChords: [{ keys: "<A-f>", action: "hints" }],
  });
  const tab = fakeTab(site);
  const view: PageView = {
    element: host.doc.getElementById("viewport") as Element,
    send: (message) => void tab.evaluate(pageRequest(message)),
    listen: tab.onMessage,
  };
  const detach = bbim.attachPage(view);
  cleanup.push(() => {
    detach();
    bbim.dispose();
    host.close();
    site.close();
  });
  const pageLabels = () => site.labels();
  return { host, site, bbim, detach, pageLabels };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("native page: hints from the host include the tab's targets, labeled inside the tab", async () => {
  const { host, site, bbim, pageLabels } = setUp();
  let bought = 0;
  site.doc.getElementById("buy")?.addEventListener("click", () => (bought += 1));
  host.key("f");
  await settle();
  assert.equal(bbim.mode(), "hint");
  assert.equal(pageLabels().length, 2, "the tab draws its own two labels (a native view covers the host's overlay)");
  const hostShown = host.labels().filter((_, index) => {
    const node = host.overlayHost()?.shadowRoot?.querySelectorAll(".hint")[index] as HTMLElement | undefined;
    return node?.style.visibility !== "hidden";
  });
  assert.equal(hostShown.length, 1, "the host's overlay shows only its own Send");
  const buy = pageLabels()[1] ?? "";
  for (const char of buy) host.key(char);
  await settle();
  assert.equal(bought, 1, "picking a tab label activates it in the tab");
  assert.equal(bbim.mode(), "normal");
  assert.deepEqual(pageLabels(), [], "and the tab's labels go");
});

test("native page: a host chord typed in the tab starts hints there; its keys pick, made-up keys do not", async () => {
  const { site, bbim, pageLabels } = setUp();
  let bought = 0;
  site.doc.getElementById("buy")?.addEventListener("click", () => (bought += 1));
  // A page script cannot fake the chord.
  typeIn(site, "ƒ", { altKey: true, code: "KeyF" }, false);
  assert.equal(bbim.mode(), "normal");
  const chord = typeIn(site, "ƒ", { altKey: true, code: "KeyF" });
  assert.equal(chord.defaultPrevented, true, "the chord never reaches the page");
  await settle();
  assert.equal(bbim.mode(), "hint");
  const buy = pageLabels()[1] ?? "";
  assert.ok(buy !== "");
  // A made-up keystroke is neither forwarded nor typed into a label.
  typeIn(site, buy, {}, false);
  assert.equal(bbim.mode(), "hint");
  for (const char of buy) typeIn(site, char);
  await settle();
  assert.equal(bought, 1);
  assert.equal(bbim.mode(), "normal");
});

test("native page: Esc typed in the tab leaves hint mode and clears its labels", async () => {
  const { site, bbim, pageLabels } = setUp();
  typeIn(site, "ƒ", { altKey: true, code: "KeyF" });
  await settle();
  assert.ok(pageLabels().length > 0);
  typeIn(site, "Escape");
  await settle();
  assert.equal(bbim.mode(), "normal");
  assert.deepEqual(pageLabels(), []);
});

test("native page: a detached or hidden tab is not asked", async () => {
  const { host, bbim, detach, pageLabels } = setUp();
  host.doc.getElementById("viewport")?.setAttribute("data-rect", "0,0,0,0");
  host.key("f");
  await settle();
  assert.deepEqual(pageLabels(), [], "a tab that shows nothing is skipped");
  host.key("Escape");
  host.doc.getElementById("viewport")?.setAttribute("data-rect", "400,40,600,760");
  detach();
  host.key("f");
  await settle();
  assert.equal(bbim.mode(), "hint");
  assert.deepEqual(pageLabels(), []);
});

test("hints: a plugin pane (a shadow-root subtree) and a same-origin iframe both get labels", () => {
  const host = page(`<main data-rect="0,0,1000,800"><div id="pane" data-plugin-pane data-rect="0,0,400,800"></div></main>`);
  const bbim = createBbim({ window: host.win });
  cleanup.push(() => {
    bbim.dispose();
    host.close();
  });
  const pane = host.doc.getElementById("pane") as HTMLElement;
  pane.attachShadow({ mode: "open" }).innerHTML = `<button id="in-pane" data-rect="10,10,80,30">Run</button>`;
  const frame = host.doc.createElement("iframe");
  frame.setAttribute("data-rect", "500,100,400,300");
  host.doc.querySelector("main")?.append(frame);
  // Same-origin: hints reach into it directly.
  layOutFrame(frame).body.innerHTML = `<button id="in-frame" data-rect="10,10,80,30">Open</button>`;
  host.key("f");
  assert.equal(host.labels().length, 2, "the pane's button and the frame's");
});
