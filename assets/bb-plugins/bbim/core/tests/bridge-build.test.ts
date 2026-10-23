// The committed classic-script bridge is current and works on its own. Run: npm test
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
// @ts-expect-error -- a plain .mjs build script without declarations
import { bundleBridge } from "../scripts/build-bridge.mjs";
import { BRIDGE_PROTOCOL } from "../src/domain/protocol.ts";
import { page } from "./harness.ts";

const built = new URL("../bridge/bbim-bridge.js", import.meta.url);

test("bridge build: the committed bridge/bbim-bridge.js matches its sources", async () => {
  const committed = await readFile(built, "utf8");
  assert.equal(committed, await (bundleBridge as () => Promise<string>)(), "run npm run build:bridge");
});

test("bridge build: the script installs itself and answers its parent", async () => {
  const frame = page(`<button data-rect="0,0,50,20">x</button>`);
  const posted: Array<unknown> = [];
  const parent = { postMessage: (message: unknown) => posted.push(message) };
  Object.defineProperty(frame.win, "parent", { value: parent, configurable: true });
  frame.win.eval(await readFile(built, "utf8"));
  frame.win.dispatchEvent(
    new frame.win.MessageEvent("message", {
      data: { bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "q" },
      origin: "https://bb.test",
      source: parent as unknown as Window,
    }),
  );
  assert.equal((posted[0] as { targets: Array<unknown> }).targets.length, 1);
  assert.equal(typeof (frame.win as unknown as { bbimBridge: { uninstall: unknown } }).bbimBridge.uninstall, "function");
  frame.close();
});
