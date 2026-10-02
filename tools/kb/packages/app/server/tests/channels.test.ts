/**
 * Plugin channels end to end: the `kb ui` server hosts the plugins its
 * caller names, provides them `UiHost`, and routes `channel` frames between
 * a plugin and the connection that sent them (`DESIGN.md` → Plugin
 * channels). The frames ride `/ws`, so the request guard admits them or
 * nothing does.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ChannelPoint, UiHost } from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { FAKE_TAB_SCREEN, FakeTab } from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

const run = Effect.runPromise;

/** A channel that answers every frame with what it can see: the data, the peer's tab, a receipt. */
function echoPlugin(dropped: string[]): Plugin {
  return definePlugin({
    name: "echo",
    inject: [UiHost],
    apply: (ctx) =>
      Effect.gen(function* () {
        const host = yield* ctx.get(UiHost);
        yield* ctx.contribute(ChannelPoint, {
          id: "chat",
          value: {
            receive: (peer, data) =>
              Effect.gen(function* () {
                const receipt = yield* host.invoke({
                  id: "node.get",
                  input: { id: "sys.tag", depth: 0 },
                });
                yield* peer.send({ echo: data, tab: peer.tab(), receipt: receipt.status });
              }),
            drop: (connection) => Effect.sync(() => void dropped.push(connection)),
          },
        });
      }),
  });
}

const failing = definePlugin({
  name: "broken",
  apply: () => Effect.die(new Error("cannot start")),
});

describe("plugin channels", () => {
  let root: string;
  let handle: UiServerHandle;
  const dropped: string[] = [];
  const tabs: FakeTab[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-channels-"));
    dropped.length = 0;
    handle = await run(
      startUi({ root, port: 0, openBrowser: false, plugins: [failing, echoPlugin(dropped)] }),
    );
  });

  afterEach(async () => {
    await run(Effect.forEach(tabs.splice(0), (tab) => tab.close, { discard: true }));
    await run(handle.stop);
    await rm(root, { recursive: true, force: true });
  });

  async function openTab(id: string): Promise<FakeTab> {
    const opened = await run(FakeTab.open(handle.url, id, FAKE_TAB_SCREEN));
    tabs.push(opened);
    return opened;
  }

  test("a frame reaches the plugin that owns the channel, and its answer comes back", async () => {
    const a = await openTab("tab.a");
    const frame = await run(a.channel("echo.chat", { hello: 1 }, () => true));
    expect(frame).toEqual({
      kind: "data",
      data: { echo: { hello: 1 }, tab: "tab.a", receipt: "succeeded" },
    });
  });

  test("a channel no plugin owns is answered with an error naming it", async () => {
    const a = await openTab("tab.a");
    const frame = await run(a.channel("nobody.home", {}, () => true));
    expect(frame).toMatchObject({ kind: "error", code: "unknown_channel" });
  });

  test("a plugin that fails to load is skipped; the others still serve", async () => {
    const a = await openTab("tab.a");
    expect(await run(a.channel("broken.chat", {}, () => true))).toMatchObject({
      kind: "error",
    });
    expect(await run(a.channel("echo.chat", 2, () => true))).toMatchObject({ kind: "data" });
  });

  test("an answer goes to the connection that asked, and a close reaches the channel", async () => {
    const a = await openTab("tab.a");
    const b = await openTab("tab.b");
    expect(await run(b.channel("echo.chat", "from b", () => true))).toMatchObject({
      data: { echo: "from b", tab: "tab.b" },
    });
    expect(a.heard("echo.chat")).toEqual([]);
    expect(b.heard("echo.chat")).toHaveLength(1);
    await run(b.close);
    tabs.splice(tabs.indexOf(b), 1);
    const deadline = Date.now() + 2000;
    while (dropped.length === 0 && Date.now() < deadline) await Bun.sleep(10);
    expect(dropped).toHaveLength(1);
  });

  test("the server's stop closes every plugin's scope", async () => {
    let released = false;
    const scoped = definePlugin({
      name: "scoped",
      apply: () =>
        Effect.asVoid(
          Effect.acquireRelease(Effect.void, () => Effect.sync(() => void (released = true))),
        ),
    });
    const other = await run(startUi({ root, port: 0, openBrowser: false, plugins: [scoped] }));
    await run(other.stop);
    expect(released).toBe(true);
  });
});
