// The hint bridge, both sides, with the frame/parent link faked: happy-dom does
// not give cross-window messages a real `source`. Run: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Effect, Fiber } from "effect";
import { installBbimBridge } from "../src/bridge/bbim-bridge.ts";
import { BRIDGE_PROTOCOL } from "../src/domain/protocol.ts";
import { collectRemote, listenForwarded } from "../src/dom/bridge-client.ts";
import type { OpaqueFrame } from "../src/dom/frames.ts";
import { openScope } from "../src/dom/runtime.ts";
import { page, type Page } from "./harness.ts";

const FRAME = `
  <a id="out" href="https://example.com/x" data-rect="10,10,100,20">Out</a>
  <button id="go" data-rect="10,40,60,24">Go</button>`;

interface Posted {
  readonly message: unknown;
  readonly origin: string;
}

let open: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const item of open) item.close();
  open = [];
});

/** A frame page whose `parent` is a recorder standing in for the embedding window. */
function framed(): { frame: Page; parent: { postMessage: (message: unknown, origin: string) => void }; posted: Array<Posted> } {
  const frame = page(FRAME);
  const posted: Array<Posted> = [];
  const parent = { postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) };
  Object.defineProperty(frame.win, "parent", { value: parent, configurable: true });
  open.push(frame);
  return { frame, parent, posted };
}

function deliver(target: Page, data: unknown, source: unknown, origin = "https://bb.test") {
  target.win.dispatchEvent(new target.win.MessageEvent("message", { data, origin, source: source as Window }));
}

test("bridge (frame): answers its parent's collect with its targets", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win });
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "r1" }, parent);
  assert.equal(posted.length, 1);
  const reply = posted[0]?.message as { type: string; requestId: string; targets: Array<{ kind: string }> };
  assert.equal(reply.type, "targets");
  assert.equal(reply.requestId, "r1");
  assert.deepEqual(
    reply.targets.map((target) => target.kind),
    ["link", "button"],
  );
  assert.equal(posted[0]?.origin, "https://bb.test", "replies go to the asking origin only");
  uninstall();
});

test("bridge (frame): ignores other windows, other origins and malformed requests", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win, parentOrigins: ["https://bb.test"] });
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "r1" }, {});
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "r1" }, parent, "https://evil.test");
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "collect", requestId: 7 }, parent);
  deliver(frame, { type: "collect", requestId: "r1" }, parent);
  assert.deepEqual(posted, []);
  uninstall();
});

test("bridge (frame): activates by id; a new-tab link becomes an open request", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win });
  let clicked = false;
  frame.doc.getElementById("go")?.addEventListener("click", () => {
    clicked = true;
  });
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "r1" }, parent);
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "r1", targetId: 1, newTab: false }, parent);
  assert.ok(clicked);
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "r1", targetId: 0, newTab: true }, parent);
  assert.deepEqual(posted.at(-1)?.message, { bbim: BRIDGE_PROTOCOL, type: "open", url: "https://example.com/x" });
  uninstall();
});

test("bridge (frame): while the parent's hint mode is up, keys are forwarded and swallowed", () => {
  const { frame, parent, posted } = framed();
  const uninstall = installBbimBridge({ window: frame.win });
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "mode", active: true }, parent);
  const pressed = frame.key("s");
  assert.ok(pressed.defaultPrevented);
  assert.equal((posted.at(-1)?.message as { key?: string } | undefined)?.key, "s");
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "mode", active: false }, parent);
  assert.equal(frame.key("s").defaultPrevented, false);
  uninstall();
  deliver(frame, { bbim: BRIDGE_PROTOCOL, type: "mode", active: true }, parent);
  assert.equal(frame.key("s").defaultPrevented, false, "uninstalled bridges do nothing");
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

test("bridge (parent): collects replies from the right window, placed and clipped", async () => {
  const { parentPage, child, frame, sent } = parentWithFrame();
  const scope = openScope();
  const fiber = scope.fork(collectRemote([frame], "r9", 1000));
  assert.deepEqual(sent, [{ bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "r9" }]);
  const reply = (requestId: string, left: number) => ({
    bbim: BRIDGE_PROTOCOL,
    type: "targets",
    requestId,
    targets: [{ id: 3, kind: "button", left, top: 10, width: 20, height: 10 }],
  });
  deliver(parentPage, reply("r9", 5), {}); // a stranger
  deliver(parentPage, reply("old", 5), child); // a stale request
  deliver(parentPage, { ...reply("r9", 5), targets: "lots" }, child); // malformed
  deliver(parentPage, reply("r9", 5), child);
  const targets = await Effect.runPromise(Fiber.join(fiber));
  assert.deepEqual(
    targets.map((target) => [target.id, target.kind, target.rect]),
    [[3, "button", { left: 105, top: 110, width: 20, height: 10 }]],
  );
  scope.close();
});

test("bridge (parent): a frame without the bridge costs only the timeout", async () => {
  const { frame } = parentWithFrame();
  const scope = openScope();
  const targets = await Effect.runPromise(Fiber.join(scope.fork(collectRemote([frame], "r1", 20))));
  assert.deepEqual(targets, []);
  scope.close();
});

test("bridge (parent): forwarded keys and open requests are decoded; unsafe URLs dropped", () => {
  const { parentPage, child, frame } = parentWithFrame();
  const keys: Array<string> = [];
  const opened: Array<string> = [];
  const scope = openScope();
  scope.run(listenForwarded([frame], { onKey: (event) => keys.push(event.key), onOpen: (url) => opened.push(url) }));
  const key = { bbim: BRIDGE_PROTOCOL, type: "key", key: "a", code: "KeyA", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
  deliver(parentPage, key, child);
  deliver(parentPage, key, {});
  deliver(parentPage, { bbim: BRIDGE_PROTOCOL, type: "open", url: "javascript:alert(1)" }, child);
  deliver(parentPage, { bbim: BRIDGE_PROTOCOL, type: "open", url: "https://example.com/" }, child);
  assert.deepEqual(keys, ["a"]);
  assert.deepEqual(opened, ["https://example.com/"]);
  scope.close();
  deliver(parentPage, key, child);
  assert.deepEqual(keys, ["a"], "closing the scope removes the listener");
});
