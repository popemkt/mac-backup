// A native page (bb's desktop Browser tab): a page shown in a native view over
// the host's window, reached by script. The fake below runs the real built
// page bridge (bridge/bbim-page.ts) in its own happy-dom window, as bb's
// `experimental_page.evaluate` would in the page's isolated world. Run: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createBbim } from "../src/dom/bbim.ts";
import { scriptedPage } from "../src/bridge/page-request.ts";
import { MODE_HEARTBEAT_MS } from "../src/domain/protocol.ts";
import { bbPageEvaluate, layOutFrame, page, type Page } from "./harness.ts";

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

/**
 * What bb's experimental_page does (bbPageEvaluate: its exact evaluation
 * contract), over a happy-dom window standing in for the tab. `navigate`
 * loads a new document (a new window: whatever was installed in the old one
 * is gone), as a navigation or a reload does.
 */
function fakeTab(html: string) {
  const listeners = new Set<(data: unknown) => void>();
  let site = page(html);
  // The page bridge's posts go to the host's listeners, those listening when it was sent (as an event's are).
  const post = (data: unknown) => {
    for (const listener of Array.from(listeners)) listener(data);
  };
  let evaluate = bbPageEvaluate(site.win, post);
  const scripts: Array<string> = [];
  return {
    page: {
      evaluate: (expression: string, options?: { readonly world?: "isolated" | "main" }) => {
        scripts.push(expression);
        return evaluate(expression, options?.world);
      },
      onMessage: (listener: (data: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    site: () => site,
    /** Every script evaluated so far. */
    scripts: () => scripts,
    navigate: () => {
      site.close();
      site = page(html);
      evaluate = bbPageEvaluate(site.win, post);
    },
    close: () => site.close(),
  };
}

/** A person's keydown in the tab: the browser marks it trusted, which a page's own script cannot. */
function typeIn(site: Page, key: string, init: Partial<KeyboardEventInit> & { code?: string } = {}, trusted = true): KeyboardEvent {
  const event = new site.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  Object.defineProperty(event, "isTrusted", { value: trusted });
  (site.doc.activeElement ?? site.doc.body).dispatchEvent(event);
  return event;
}

const chordIn = (site: Page) => typeIn(site, "ƒ", { altKey: true, code: "KeyF" });

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** A host with one Browser tab attached, once the tab's bridge is in (installing takes a round trip). */
async function setUp() {
  const host = page(HOST);
  const bbim = createBbim({
    window: host.win,
    settings: { hintAlphabet: "sadfjkl" },
    bridgeTimeoutMs: 200,
    hostChords: [{ keys: "<A-f>", action: "hints" }],
  });
  const tab = fakeTab(SITE);
  const errors: Array<unknown> = [];
  const view = scriptedPage(host.doc.getElementById("viewport") as Element, tab.page, (error) => errors.push(error));
  const detach = bbim.attachPage(view);
  cleanup.push(() => {
    detach();
    bbim.dispose();
    host.close();
    tab.close();
  });
  await settle();
  return {
    host,
    tab,
    errors,
    /** The tab's current document. */
    get site() {
      return tab.site();
    },
    bbim,
    detach,
    pageLabels: () => tab.site().labels(),
  };
}

test("native page: hints from the host include the tab's targets, labeled inside the tab", async () => {
  const { host, site, bbim, pageLabels } = await setUp();
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
  const { site, bbim, pageLabels } = await setUp();
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
  const { site, bbim, pageLabels } = await setUp();
  typeIn(site, "ƒ", { altKey: true, code: "KeyF" });
  await settle();
  assert.ok(pageLabels().length > 0);
  typeIn(site, "Escape");
  await settle();
  assert.equal(bbim.mode(), "normal");
  assert.deepEqual(pageLabels(), []);
});

test("native page: a detached or hidden tab is not asked", async () => {
  const { host, bbim, detach, pageLabels } = await setUp();
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

test("native page: a detached tab keeps no chords and forwards nothing", async () => {
  const r = await setUp();
  r.detach();
  await settle();
  const chord = chordIn(r.site);
  assert.equal(chord.defaultPrevented, false, "the page lets the chord through once let go of");
  await settle();
  assert.equal(r.bbim.mode(), "normal");
});

test("native page: the bridge script goes along only to a document that lacks it", async () => {
  const r = await setUp();
  await settle();
  const installs = () => r.tab.scripts().filter((script) => script.length > 2000).length;
  const first = installs();
  assert.ok(first >= 1);
  chordIn(r.site);
  await settle();
  typeIn(r.site, "Escape");
  await settle();
  assert.equal(installs(), first, "a document that has the bridge gets requests only");
  r.tab.navigate();
  r.host.key("f");
  await settle();
  assert.ok(installs() > first, "a new document gets it again");
  r.host.key("Escape");
  assert.deepEqual(r.errors, []);
});

// ---- regressions (review of the Browser-tab bridge) ---------------------------

test("native page: navigating mid-hint ends the session; the new document swallows nothing", async () => {
  const r = await setUp();
  chordIn(r.site);
  await settle();
  assert.equal(r.bbim.mode(), "hint");
  r.tab.navigate();
  // The next heartbeat reaches the new document: it installs, refuses the stale
  // session's mode, and announces itself, which ends the session.
  await settle(MODE_HEARTBEAT_MS + 200);
  assert.equal(r.bbim.mode(), "normal");
  const key = typeIn(r.site, "q", { code: "KeyQ" });
  assert.equal(key.defaultPrevented, false, "keys reach the new page");
  assert.deepEqual(r.pageLabels(), []);
});

test("native page: after a reload to the same URL the chords come back within the keep-alive", async () => {
  const r = await setUp();
  await settle();
  r.tab.navigate();
  assert.equal(chordIn(r.site).defaultPrevented, false, "a fresh document knows no chords yet");
  await settle(2200);
  assert.equal(chordIn(r.site).defaultPrevented, true);
  await settle();
  assert.equal(r.bbim.mode(), "hint");
});

test("native page: a key flood ends the session instead of leaving the page swallowing keys", async () => {
  const r = await setUp();
  chordIn(r.site);
  await settle();
  for (let index = 0; index < 300; index += 1) typeIn(r.site, "z", { code: "KeyZ" });
  await settle();
  assert.equal(r.bbim.mode(), "normal", "past the budget the session ends");
  assert.equal(typeIn(r.site, "q", { code: "KeyQ" }).defaultPrevented, false, "and the page stops forwarding");
});

test("native page: a page script's pointerdown does not end hints; a person's does", async () => {
  const r = await setUp();
  chordIn(r.site);
  await settle();
  const down = (trusted: boolean) => {
    const event = new r.site.win.PointerEvent("pointerdown", { bubbles: true, composed: true });
    Object.defineProperty(event, "isTrusted", { value: trusted });
    r.site.doc.body.dispatchEvent(event);
  };
  down(false);
  await settle();
  assert.equal(r.bbim.mode(), "hint");
  assert.ok(r.pageLabels().length > 0, "the page keeps its labels");
  down(true);
  await settle();
  assert.equal(r.bbim.mode(), "normal");
});

test("native page: labeling again after a pick moved keeps the page forwarding", async () => {
  const r = await setUp();
  chordIn(r.site);
  await settle();
  const nodes = [...(r.host.overlayHost()?.shadowRoot?.querySelectorAll(".hint") ?? [])] as Array<HTMLElement>;
  const send = nodes.find((node) => !node.hidden)?.textContent ?? "";
  assert.ok(send !== "", "the host's Send has a label");
  r.host.doc.getElementById("send")?.setAttribute("data-rect", "10,500,80,30");
  for (const char of send) typeIn(r.site, char);
  await settle();
  assert.equal(r.bbim.mode(), "hint", "Send moved: labeled again");
  assert.equal(typeIn(r.site, "q", { code: "KeyQ" }).defaultPrevented, true, "the page still forwards keys typed in it");
  typeIn(r.site, "Escape");
  await settle();
  assert.equal(r.bbim.mode(), "normal");
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
