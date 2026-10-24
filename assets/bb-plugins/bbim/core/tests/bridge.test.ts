// The hint bridge, both sides, with the frame/parent link faked: happy-dom does
// not give cross-window messages a real `source`. Run: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Effect, Fiber, Option } from "effect";
import { installBbimBridge } from "../src/bridge/bbim-bridge.ts";
import { BRIDGE_PROTOCOL, FRAME_MESSAGE_BUDGET } from "../src/domain/protocol.ts";
import { awaitOpen, collectRemote, frameBudget, iframeRemote, listenForwarded } from "../src/dom/bridge-client.ts";
import type { OpaqueFrame } from "../src/dom/frames.ts";
import { openScope } from "../src/dom/runtime.ts";
import { page, type Page } from "./harness.ts";

const FRAME = `
  <a id="out" href="https://example.com/x" data-rect="10,10,100,20">Out</a>
  <button id="go" data-rect="10,40,60,24">Go</button>`;
const BB = "https://bb.test";

interface Posted {
  readonly message: unknown;
  readonly origin: string;
}

let open: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const item of open) item.close();
  open = [];
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A frame page whose `parent` is a recorder standing in for the embedding window. */
function framed(html = FRAME): { frame: Page; parent: { postMessage: (message: unknown, origin: string) => void }; posted: Array<Posted> } {
  const frame = page(html);
  const posted: Array<Posted> = [];
  const parent = { postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) };
  Object.defineProperty(frame.win, "parent", { value: parent, configurable: true });
  open.push(frame);
  return { frame, parent, posted };
}

function deliver(target: Page, data: unknown, source: unknown, origin = BB) {
  target.win.dispatchEvent(new target.win.MessageEvent("message", { data, origin, source: source as Window }));
}

const collect = (requestId = "r1") => ({ bbim: BRIDGE_PROTOCOL, type: "collect", requestId });
const mode = (active: boolean, requestId = "r1") => ({ bbim: BRIDGE_PROTOCOL, type: "mode", active, requestId });

test("bridge (frame): fails closed: no parent origins, no bridge", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [] });
  deliver(frame, collect(), parent);
  deliver(frame, mode(true), parent);
  assert.deepEqual(posted, []);
  assert.equal(frame.key("s").defaultPrevented, false, "keys are never forwarded");
  uninstall();
  const wildcard = installBbimBridge({ window: frame.win, parentOrigins: ["*"] });
  deliver(frame, collect(), parent);
  assert.deepEqual(posted, [], "'*' is not an origin");
  wildcard();
});

test("bridge (frame): answers its parent's collect with its targets", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  deliver(frame, collect(), parent);
  assert.equal(posted.length, 1);
  const reply = posted[0]?.message as { type: string; requestId: string; targets: Array<{ kind: string }> };
  assert.equal(reply.type, "targets");
  assert.equal(reply.requestId, "r1");
  assert.deepEqual(
    reply.targets.map((target) => target.kind),
    ["link", "button"],
  );
  assert.equal(posted[0]?.origin, BB, "replies go to the asking origin only");
  uninstall();
});

test("bridge (frame): ignores other windows, unlisted origins and malformed requests", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  deliver(frame, collect(), {});
  deliver(frame, collect(), parent, "https://evil.test");
  deliver(frame, { ...collect(), requestId: 7 }, parent);
  deliver(frame, { type: "collect", requestId: "r1" }, parent);
  deliver(frame, mode(true), parent, "https://evil.test");
  assert.deepEqual(posted, []);
  assert.equal(frame.key("s").defaultPrevented, false, "an unlisted origin cannot switch on forwarding");
  uninstall();
});

test("bridge (frame): an opaque (null) parent may list targets, never forward keys or click", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: ["null"] });
  let clicked = false;
  frame.doc.getElementById("go")?.addEventListener("click", () => {
    clicked = true;
  });
  deliver(frame, collect(), parent, "null");
  assert.equal(posted.length, 1);
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "r1", targetId: 1, newTab: false }, parent, "null");
  deliver(frame, mode(true), parent, "null");
  assert.equal(clicked, false);
  assert.equal(frame.key("s").defaultPrevented, false);
  uninstall();
});

test("bridge (frame): activates by id; a new-tab link becomes an open request for that activation", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  let clicked = false;
  frame.doc.getElementById("go")?.addEventListener("click", () => {
    clicked = true;
  });
  deliver(frame, collect(), parent);
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "r1", targetId: 1, newTab: false }, parent);
  assert.ok(clicked);
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "r1", targetId: 0, newTab: true }, parent);
  assert.deepEqual(posted.at(-1)?.message, { bbim: BRIDGE_PROTOCOL, type: "open", requestId: "r1", url: "https://example.com/x" });
  uninstall();
});

test("bridge (frame): forwarding keys runs while renewed and stops on its own when the parent goes quiet", async () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB], modeTtlMs: 60 });
  deliver(frame, mode(true), parent);
  const pressed = frame.key("s");
  assert.ok(pressed.defaultPrevented);
  assert.equal((posted.at(-1)?.message as { key?: string } | undefined)?.key, "s");
  await sleep(40);
  deliver(frame, mode(true), parent);
  await sleep(40);
  assert.ok(frame.key("s").defaultPrevented, "a renewal keeps it on past the first ttl");
  await sleep(80);
  assert.equal(frame.key("s").defaultPrevented, false, "no renewal: the frame gets its keys back");
  deliver(frame, mode(true), parent);
  deliver(frame, mode(false), parent);
  assert.equal(frame.key("s").defaultPrevented, false);
  uninstall();
});

test("bridge (frame): one bridge per window; uninstall forgets targets and allows a new one", () => {
  const { frame, parent, posted } = framed();
  const first = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  const second = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  deliver(frame, collect(), parent);
  assert.equal(posted.length, 1, "the refused second install answers nothing");
  second();
  deliver(frame, collect("r2"), parent);
  assert.equal(posted.length, 2, "uninstalling the refused one leaves the first working");
  first();
  deliver(frame, mode(true), parent);
  assert.equal(frame.key("s").defaultPrevented, false, "uninstalled bridges do nothing");
  const again = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  let clicked = false;
  frame.doc.getElementById("go")?.addEventListener("click", () => {
    clicked = true;
  });
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "r2", targetId: 1, newTab: false }, parent);
  assert.equal(clicked, false, "targets of an uninstalled bridge are gone");
  again();
});

test("bridge (frame): held keys and IME keys are swallowed but not forwarded", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  deliver(frame, mode(true), parent);
  assert.ok(frame.key("s", { repeat: true }).defaultPrevented);
  assert.ok(frame.key("s", { isComposing: true }).defaultPrevented);
  assert.ok(frame.key("Process").defaultPrevented);
  assert.equal(posted.length, 0, "nothing forwarded");
  frame.key("s");
  assert.deepEqual(posted.at(-1)?.message, {
    bbim: BRIDGE_PROTOCOL,
    type: "key",
    key: "s",
    code: "",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
  });
  uninstall();
});

test("bridge (frame): a click in the frame or a lapse stops forwarding and tells the parent", async () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB], modeTtlMs: 30 });
  deliver(frame, mode(true), parent);
  const click = (trusted: boolean) => {
    const event = new frame.win.PointerEvent("pointerdown", { bubbles: true });
    Object.defineProperty(event, "isTrusted", { value: trusted });
    frame.doc.body.dispatchEvent(event);
  };
  click(false);
  assert.equal(posted.length, 0, "a page script's click does not end hints");
  assert.equal(frame.key("s").defaultPrevented, true, "and forwarding goes on");
  click(true);
  assert.deepEqual(posted.at(-1)?.message, { bbim: BRIDGE_PROTOCOL, type: "leave", reason: "pointer" });
  assert.equal(frame.key("s").defaultPrevented, false);
  deliver(frame, mode(true), parent);
  await sleep(60);
  assert.deepEqual(posted.at(-1)?.message, { bbim: BRIDGE_PROTOCOL, type: "leave", reason: "lapsed" });
  deliver(frame, mode(true), parent);
  deliver(frame, mode(false), parent);
  assert.equal(posted.length, 3, "the parent turning it off needs no notice");
  uninstall();
});

test("bridge (frame): a late `mode` on for a session already turned off is ignored", () => {
  const { frame, parent } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  deliver(frame, mode(false, "r1"), parent);
  deliver(frame, mode(true, "r1"), parent);
  assert.equal(frame.key("s").defaultPrevented, false, "the stale session does not swallow keys");
  deliver(frame, mode(true, "r2"), parent);
  deliver(frame, mode(false, "r1"), parent);
  assert.equal(frame.key("s").defaultPrevented, true, "turning an older session off leaves the new one on");
  deliver(frame, mode(false, "r2"), parent);
  assert.equal(frame.key("s").defaultPrevented, false);
  uninstall();
});

const PANES = `
  <input id="search" data-rect="10,10,200,24">
  <div id="outline" style="overflow-y:auto" data-rect="0,50,400,300"><p data-rect="0,50,400,900">rows</p></div>
  <button id="go" data-rect="10,400,60,24">Go</button>`;

const collectFor = (picker: string, requestId = "r1") => ({ bbim: BRIDGE_PROTOCOL, type: "collect", requestId, picker });
const activate = (targetId: number, requestId = "r1") => ({ bbim: BRIDGE_PROTOCOL, type: "activate", requestId, targetId, newTab: false });
const scrollBy = (action: string) => ({ bbim: BRIDGE_PROTOCOL, type: "scroll", action, step: 70, repeat: true });

/** Give `element` a scroll box happy-dom does not lay out, and record its scrolls. */
function scrollable(element: Element, height: number, scrolled: Array<number>) {
  Object.defineProperty(element, "scrollHeight", { value: height, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: 300, configurable: true });
  (element as HTMLElement).scrollBy = ((options: ScrollToOptions) => scrolled.push(options.top ?? 0)) as HTMLElement["scrollBy"];
}

test("bridge (frame): an inputs collect reports the text inputs only, and activating one focuses it", () => {
  const { frame, parent, posted } = framed(PANES);
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  deliver(frame, collectFor("inputs"), parent);
  const reply = posted[0]?.message as { targets: Array<{ id: number; kind?: string; left: number }> };
  assert.deepEqual(
    reply.targets.map((target) => [target.id, target.kind, target.left]),
    [[0, undefined, 10]],
    "one input, with no kind: picking it focuses it",
  );
  deliver(frame, activate(0), parent);
  assert.equal(frame.doc.activeElement?.id, "search");
  uninstall();
});

test("bridge (frame): a scroll collect reports its panes; scroll moves only the one picked", () => {
  const { frame, parent, posted } = framed(PANES);
  const outline = frame.doc.getElementById("outline") as Element;
  const scrolled: Array<number> = [];
  scrollable(outline, 900, scrolled);
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  deliver(frame, scrollBy("scrollDown"), parent);
  assert.deepEqual(scrolled, [], "nothing picked: nothing scrolls");
  deliver(frame, collectFor("scroll"), parent);
  const reply = posted[0]?.message as { targets: Array<{ id: number; kind?: string; top: number }> };
  assert.deepEqual(reply.targets.map((target) => [target.id, target.kind, target.top]), [[0, undefined, 50]]);
  deliver(frame, activate(0), parent);
  deliver(frame, scrollBy("scrollDown"), parent);
  deliver(frame, scrollBy("scrollUp"), parent);
  assert.deepEqual(scrolled, [70, -70]);
  deliver(frame, { ...scrollBy("scrollDown"), action: "explode" }, parent);
  deliver(frame, scrollBy("scrollDown"), parent, "null");
  assert.deepEqual(scrolled, [70, -70], "unknown actions and an opaque parent scroll nothing");
  uninstall();
});

test("bridge (frame): a hints collect after a scroll pick activates as hints again", () => {
  const { frame, parent } = framed(PANES);
  let clicked = 0;
  frame.doc.getElementById("go")?.addEventListener("click", () => (clicked += 1));
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  deliver(frame, collectFor("scroll"), parent);
  deliver(frame, collect("r2"), parent);
  deliver(frame, activate(1, "r2"), parent);
  assert.equal(clicked, 1, "the second target of the hints collect is the button");
  uninstall();
});

const chordsMessage = (list: Array<Record<string, unknown>>) => ({ bbim: BRIDGE_PROTOCOL, type: "chords", chords: list });
const ALT_F = { code: "KeyF", ctrlKey: false, altKey: true, metaKey: false, shiftKey: false };

test("bridge (frame): the parent's chords typed here go back to it, unless the page took the key", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: [BB] });
  const altF = () => frame.key("ƒ", { altKey: true, code: "KeyF" });
  assert.equal(altF().defaultPrevented, false, "no chords yet: the key is the page's");
  deliver(frame, chordsMessage([ALT_F]), parent);
  const passed = altF();
  assert.equal(passed.defaultPrevented, true, "a chord nobody here took is swallowed");
  assert.deepEqual(posted.at(-1), {
    message: { bbim: BRIDGE_PROTOCOL, type: "key", key: "ƒ", code: "KeyF", ctrlKey: false, altKey: true, metaKey: false, shiftKey: false, repeat: false, isComposing: false },
    origin: BB,
  });
  assert.equal(frame.key("f", { code: "KeyF" }).defaultPrevented, false, "a plain key stays the page's");
  const count = posted.length;
  // The page binds alt+f itself (registered after the bridge, as an app's keymap is): its binding wins.
  const own = (event: KeyboardEvent) => {
    if (event.altKey) event.preventDefault();
  };
  frame.win.addEventListener("keydown", own);
  altF();
  assert.equal(posted.length, count, "a key the page handled is not passed back");
  frame.win.removeEventListener("keydown", own);
  // A page that stops the key before it reaches the window keeps it too, and nothing lingers for the next one.
  const stopper = (event: Event) => event.stopPropagation();
  frame.doc.body.addEventListener("keydown", stopper);
  altF();
  frame.doc.body.removeEventListener("keydown", stopper);
  assert.equal(posted.length, count);
  altF();
  assert.equal(posted.length, count + 1, "the next chord goes back as before");
  deliver(frame, chordsMessage([]), parent);
  assert.equal(altF().defaultPrevented, false, "cleared chords pass nothing back");
  deliver(frame, chordsMessage([ALT_F]), parent, "null");
  assert.equal(altF().defaultPrevented, false, "an opaque parent cannot set chords");
  uninstall();
});

/** A parent page with one fake opaque frame whose window records what it is sent. */
function parentWithFrame() {
  const parentPage = page("");
  open.push(parentPage);
  const sent: Array<unknown> = [];
  const child = { postMessage: (message: unknown) => sent.push(message) };
  const element = { contentWindow: child } as unknown as HTMLIFrameElement;
  const opaque: OpaqueFrame = {
    element,
    host: parentPage.win,
    box: { left: 100, top: 100, width: 300, height: 200 },
    offsetX: 100,
    offsetY: 100,
  };
  return { parentPage, child, frame: iframeRemote(opaque), sent };
}

const targets = (requestId: string, left: number) => ({
  bbim: BRIDGE_PROTOCOL,
  type: "targets",
  requestId,
  targets: [{ id: 3, kind: "button", left, top: 10, width: 20, height: 10 }],
});

test("bridge (parent): collects replies from the right window, placed and clipped", async () => {
  const { parentPage, child, frame, sent } = parentWithFrame();
  const scope = openScope();
  const fiber = scope.fork(collectRemote([frame], "r9", 1000));
  assert.deepEqual(sent, [{ bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "r9" }]);
  deliver(parentPage, targets("r9", 5), {}); // a stranger
  deliver(parentPage, targets("old", 5), child); // a stale request
  deliver(parentPage, { ...targets("r9", 5), targets: "lots" }, child); // malformed
  deliver(parentPage, targets("r9", 5), child);
  const found = await Effect.runPromise(Fiber.join(fiber));
  assert.deepEqual(
    found.map((target) => [target.id, target.kind, target.rect]),
    [[3, "button", { left: 105, top: 110, width: 20, height: 10 }]],
  );
  scope.close();
});

test("bridge (parent): a frame without the bridge costs only the timeout", async () => {
  const { frame } = parentWithFrame();
  const scope = openScope();
  const found = await Effect.runPromise(Fiber.join(scope.fork(collectRemote([frame], "r1", 20))));
  assert.deepEqual(found, []);
  scope.close();
});

/** Count the message listeners a window holds. */
function countListeners(win: Window): { readonly live: () => number } {
  let live = 0;
  const add = win.addEventListener.bind(win);
  const remove = win.removeEventListener.bind(win);
  win.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "message") live += 1;
    add(type, listener, options);
  }) as typeof win.addEventListener;
  win.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "message") live -= 1;
    remove(type, listener, options);
  }) as typeof win.removeEventListener;
  return { live: () => live };
}

test("bridge (parent): an answered collect or open leaves no listener behind", async () => {
  const { parentPage, child, frame } = parentWithFrame();
  const listeners = countListeners(parentPage.win);
  const scope = openScope();
  const collecting = scope.fork(collectRemote([frame], "r1", 1000));
  assert.equal(listeners.live(), 1);
  deliver(parentPage, targets("r1", 5), child);
  assert.equal((await Effect.runPromise(Fiber.join(collecting))).length, 1);
  assert.equal(listeners.live(), 0, "collect stops listening once every frame answered");
  const opening = scope.fork(awaitOpen(frame, "r1", 1000));
  deliver(parentPage, { bbim: BRIDGE_PROTOCOL, type: "open", requestId: "r1", url: "https://example.com/" }, child);
  assert.ok(Option.isSome(await Effect.runPromise(Fiber.join(opening))));
  assert.equal(listeners.live(), 0, "awaitOpen stops listening once answered");
  await Effect.runPromise(Fiber.join(scope.fork(collectRemote([frame], "r2", 10))));
  assert.equal(listeners.live(), 0, "and after a timeout");
  scope.close();
});

test("bridge (parent): a frame that floods bridge messages spends its budget; other traffic costs nothing", async () => {
  const { parentPage, child, frame } = parentWithFrame();
  const scope = openScope();
  const quiet = scope.fork(collectRemote([frame], "r1", 50, frameBudget()));
  for (let index = 0; index < FRAME_MESSAGE_BUDGET * 2; index += 1) deliver(parentPage, { notOurs: index }, child);
  deliver(parentPage, targets("r1", 5), child);
  assert.equal((await Effect.runPromise(Fiber.join(quiet))).length, 1, "non-bridge messages are not charged");
  const flooded = scope.fork(collectRemote([frame], "r2", 50, frameBudget()));
  for (let index = 0; index < FRAME_MESSAGE_BUDGET; index += 1) deliver(parentPage, targets("stale", 1), child);
  deliver(parentPage, targets("r2", 5), child);
  assert.deepEqual(await Effect.runPromise(Fiber.join(flooded)), [], "the real reply came after the budget");
  scope.close();
});

const keyMessage = (key: string, extra: Record<string, unknown> = {}) => ({
  bbim: BRIDGE_PROTOCOL,
  type: "key",
  key,
  code: "",
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...extra,
});

test("bridge (parent): forwarded keys are heard from the given frame only, never repeats or IME keys", () => {
  const { parentPage, child, frame } = parentWithFrame();
  const other = parentWithFrame();
  const keys: Array<string> = [];
  let left = 0;
  const scope = openScope();
  scope.run(listenForwarded(frame, { onKey: (event) => keys.push(event.key), onLeave: () => (left += 1) }));
  deliver(parentPage, keyMessage("a"), child);
  deliver(parentPage, keyMessage("a"), other.child);
  deliver(parentPage, keyMessage("a"), {});
  deliver(parentPage, keyMessage("b", { repeat: true }), child);
  deliver(parentPage, keyMessage("c", { isComposing: true }), child);
  assert.deepEqual(keys, ["a"]);
  deliver(parentPage, { bbim: BRIDGE_PROTOCOL, type: "leave", reason: "pointer" }, child);
  assert.equal(left, 1);
  scope.close();
  deliver(parentPage, keyMessage("a"), child);
  assert.deepEqual(keys, ["a"], "closing the scope removes the listener");
});

test("bridge (parent): an open request is honored only as the answer to that activation", async () => {
  const { parentPage, child, frame } = parentWithFrame();
  const openRequest = (requestId: string, url: string) => ({ bbim: BRIDGE_PROTOCOL, type: "open", requestId, url });
  deliver(parentPage, openRequest("r1", "https://early.test/"), child); // before anyone asked
  const scope = openScope();
  const fiber = scope.fork(awaitOpen(frame, "r1", 200));
  deliver(parentPage, openRequest("r0", "https://other.test/"), child);
  deliver(parentPage, openRequest("r1", "javascript:alert(1)"), child);
  deliver(parentPage, openRequest("r1", "https://example.com/"), child);
  deliver(parentPage, openRequest("r1", "https://second.test/"), child);
  assert.deepEqual(await Effect.runPromise(Fiber.join(fiber)), Option.some("https://example.com/"));
  const none = await Effect.runPromise(Fiber.join(scope.fork(awaitOpen(frame, "r2", 20))));
  assert.ok(Option.isNone(none), "no answer, no tab");
  scope.close();
});
