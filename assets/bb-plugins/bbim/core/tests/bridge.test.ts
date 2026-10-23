// The hint bridge, both sides, with the frame/parent link faked: happy-dom does
// not give cross-window messages a real `source`. Run: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Effect, Fiber, Option } from "effect";
import { installBbimBridge } from "../src/bridge/bbim-bridge.ts";
import { BRIDGE_PROTOCOL, FRAME_MESSAGE_BUDGET } from "../src/domain/protocol.ts";
import { awaitOpen, collectRemote, frameBudget, listenForwarded } from "../src/dom/bridge-client.ts";
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
function framed(): { frame: Page; parent: { postMessage: (message: unknown, origin: string) => void }; posted: Array<Posted> } {
  const frame = page(FRAME);
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
const mode = (active: boolean) => ({ bbim: BRIDGE_PROTOCOL, type: "mode", active });

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

/** A parent page with one fake opaque frame whose window records what it is sent. */
function parentWithFrame() {
  const parentPage = page("");
  open.push(parentPage);
  const sent: Array<unknown> = [];
  const child = { postMessage: (message: unknown) => sent.push(message) };
  const element = { contentWindow: child } as unknown as HTMLIFrameElement;
  const frame: OpaqueFrame = {
    element,
    host: parentPage.win,
    box: { left: 100, top: 100, width: 300, height: 200 },
    offsetX: 100,
    offsetY: 100,
  };
  return { parentPage, child, frame, sent };
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

test("bridge (parent): a frame that floods spends its budget and is then not read at all", async () => {
  const { parentPage, child, frame } = parentWithFrame();
  const scope = openScope();
  const budget = frameBudget();
  const fiber = scope.fork(collectRemote([frame], "r1", 50, budget));
  for (let index = 0; index < FRAME_MESSAGE_BUDGET; index += 1) deliver(parentPage, { junk: index }, child);
  deliver(parentPage, targets("r1", 5), child);
  assert.deepEqual(await Effect.runPromise(Fiber.join(fiber)), [], "the real reply came after the budget");
  scope.close();
});

test("bridge (parent): forwarded keys are heard from the given frame only", () => {
  const { parentPage, child, frame } = parentWithFrame();
  const other = parentWithFrame();
  const keys: Array<string> = [];
  const scope = openScope();
  scope.run(listenForwarded(frame, (event) => keys.push(event.key)));
  const key = { bbim: BRIDGE_PROTOCOL, type: "key", key: "a", code: "KeyA", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
  deliver(parentPage, key, child);
  deliver(parentPage, key, other.child);
  deliver(parentPage, key, {});
  assert.deepEqual(keys, ["a"]);
  scope.close();
  deliver(parentPage, key, child);
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
