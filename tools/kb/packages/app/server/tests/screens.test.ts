/**
 * The screen channel end to end: tabs are `/ws` connections that publish a
 * screen (`FakeTab`), the server keeps the latest per tab in memory, and the
 * `ui.*` actions read and drive them — over `POST /api/action`, and from
 * another process through `.kb/ui.json`. The surface contract proves every
 * surface returns the same receipts; this file proves what those receipts are.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  ActionResponseSchema,
  ScreenListSchema,
  ScreenReceiptSchema,
  type ActionInvocation,
  type ScreenState,
} from "@kb/contracts";
import { invoke, openKb } from "@kb/runtime";
import { FAKE_TAB_SCREEN, FakeTab } from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

const run = Effect.runPromise;

async function post(handle: UiServerHandle, invocation: ActionInvocation): Promise<unknown> {
  const res = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invocation),
  });
  const response = ActionResponseSchema.parse(await res.json());
  if (response.status === "failed") throw new Error(`${invocation.id}: ${response.message}`);
  return response.output;
}

async function screen(handle: UiServerHandle, input: object = {}) {
  return ScreenListSchema.parse(await post(handle, { id: "ui.screen", input }));
}

async function command(handle: UiServerHandle, id: "ui.navigate" | "ui.select", input: object) {
  return ScreenReceiptSchema.parse(await post(handle, { id, input }));
}

/** `read` until `done` accepts it, for at most two seconds; the last answer either way. */
async function eventually<A>(read: () => Promise<A>, done: (value: A) => boolean): Promise<A> {
  const deadline = Date.now() + 2000;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await Bun.sleep(10);
    value = await read();
  }
  return value;
}

function on(route: string, active = true): ScreenState {
  return { ...FAKE_TAB_SCREEN, route, active };
}

describe("screen state", () => {
  let root: string;
  let handle: UiServerHandle;
  const tabs: FakeTab[] = [];

  async function tab(id: string, state?: ScreenState): Promise<FakeTab> {
    const opened = await run(FakeTab.open(handle.url, id, state));
    tabs.push(opened);
    return opened;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-screens-"));
    handle = await run(startUi({ root, port: 0, openBrowser: false }));
  });

  afterEach(async () => {
    for (const opened of tabs.splice(0)) await run(opened.close);
    await run(handle.stop);
    await rm(root, { recursive: true, force: true });
  });

  test("a tab is listed once it publishes, updated in place, and dropped when it closes", async () => {
    expect(await screen(handle)).toEqual({ tabs: [] });

    const a = await tab("tab.a");
    expect(await screen(handle)).toEqual({ tabs: [{ tab: "tab.a", ...FAKE_TAB_SCREEN }] });

    await run(a.publish(on("/canvas")));
    expect((await screen(handle)).tabs.map((t) => [t.tab, t.route])).toEqual([
      ["tab.a", "/canvas"],
    ]);

    await run(a.close);
    // The server takes the close on its own turn, so the list empties soon after.
    expect(
      await eventually(
        () => screen(handle),
        (list) => list.tabs.length === 0,
      ),
    ).toEqual({
      tabs: [],
    });
  });

  test("tabs are listed most recently active first, and one can be asked for by id", async () => {
    const a = await tab("tab.a");
    await tab("tab.b");
    expect((await screen(handle)).tabs.map((t) => t.tab)).toEqual(["tab.b", "tab.a"]);

    // A tab that changes in the background keeps its place; one in use moves up.
    await run(a.publish(on("/graph", false)));
    expect((await screen(handle)).tabs.map((t) => t.tab)).toEqual(["tab.b", "tab.a"]);
    await run(a.publish(on("/graph", true)));
    expect((await screen(handle)).tabs.map((t) => t.tab)).toEqual(["tab.a", "tab.b"]);

    expect((await screen(handle, { tab: "tab.b" })).tabs.map((t) => t.tab)).toEqual(["tab.b"]);
    expect(await screen(handle, { tab: "tab.gone" })).toEqual({ tabs: [] });
  });

  test("a tab that has never had attention comes after one that has", async () => {
    await tab("tab.a");
    await tab("tab.background", on("/", false));
    expect((await screen(handle)).tabs.map((t) => t.tab)).toEqual(["tab.a", "tab.background"]);
  });

  test("a tab that reconnects keeps its screen when the old connection closes late", async () => {
    const first = await tab("tab.a");
    const second = await tab("tab.a", on("/canvas"));
    await run(first.close);
    expect((await screen(handle)).tabs.map((t) => [t.tab, t.route])).toEqual([
      ["tab.a", "/canvas"],
    ]);
    expect(await command(handle, "ui.navigate", { route: "/" })).toEqual({
      outcome: "applied",
      tab: "tab.a",
    });
    expect(second.commands).toHaveLength(1);
    expect(first.commands).toEqual([]);
  });

  test("a connection that never publishes is not a tab", async () => {
    const socket = new WebSocket(`${handle.url.replace(/^http/, "ws")}/ws?origin=subscriber`);
    await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
    expect(await screen(handle)).toEqual({ tabs: [] });
    expect(await command(handle, "ui.navigate", { route: "/" })).toEqual({ outcome: "no-tab" });
    socket.close();
  });

  test("navigate goes to the most recent tab, which carries it out and answers", async () => {
    const a = await tab("tab.a");
    const b = await tab("tab.b");
    expect(await command(handle, "ui.navigate", { node: "n.x" })).toEqual({
      outcome: "applied",
      tab: "tab.b",
    });
    expect(b.commands).toEqual([{ kind: "navigate", to: { node: "n.x" } }]);
    expect(a.commands).toEqual([]);

    expect(
      await command(handle, "ui.navigate", { tab: "tab.a", pane: "main", route: "/graph" }),
    ).toEqual({
      outcome: "applied",
      tab: "tab.a",
    });
    expect(a.commands).toEqual([{ kind: "navigate", pane: "main", to: { route: "/graph" } }]);
  });

  test("select carries the selection and focus, and a tab's refusal is its receipt", async () => {
    const a = await tab("tab.a");
    a.answer = { outcome: "rejected", reason: "the open view takes no selection" };
    expect(await command(handle, "ui.select", { selection: ["n.x"], focus: "n.x" })).toEqual({
      outcome: "rejected",
      tab: "tab.a",
      reason: "the open view takes no selection",
    });
    expect(a.commands).toEqual([{ kind: "select", selection: ["n.x"], focus: "n.x" }]);
  });

  test("with no tab, or not the tab asked for, a command is no-tab", async () => {
    expect(await command(handle, "ui.navigate", { route: "/" })).toEqual({ outcome: "no-tab" });
    await tab("tab.a");
    expect(await command(handle, "ui.select", { tab: "tab.gone", selection: [] })).toEqual({
      outcome: "no-tab",
      tab: "tab.gone",
    });
  });

  test("a tab that does not answer in time is a timeout", async () => {
    const a = await tab("tab.a");
    a.answer = "silent";
    expect(await command(handle, "ui.navigate", { route: "/", timeoutMs: 50 })).toEqual({
      outcome: "timeout",
      tab: "tab.a",
      timeoutMs: 50,
    });
    expect(a.commands).toHaveLength(1);
  });

  test("a tab that closes before it answers is no longer live", async () => {
    const a = await tab("tab.a");
    a.answer = "silent";
    const pending = command(handle, "ui.navigate", { route: "/", timeoutMs: 5000 });
    // The command is on its way once the tab has it.
    while (a.commands.length === 0) await Bun.sleep(5);
    await run(a.close);
    expect(await pending).toEqual({ outcome: "no-tab", tab: "tab.a" });
  });

  test("the server answers from its own tabs, never by asking the server .kb/ui.json names", async () => {
    await tab("tab.a");
    // Were the server forwarding to itself, a missing presence file would make this no-tab.
    await rm(join(root, ".kb", "ui.json"));
    expect(await command(handle, "ui.navigate", { route: "/" })).toEqual({
      outcome: "applied",
      tab: "tab.a",
    });
  });

  test("another process reaches the tabs through .kb/ui.json", async () => {
    const presence = JSON.parse(await readFile(join(root, ".kb", "ui.json"), "utf8")) as unknown;
    expect(presence).toEqual({ url: handle.url });

    await tab("tab.a");
    const ctx = await openKb(root);
    const listed = await invoke(ctx, { id: "ui.screen", input: {} });
    expect(listed).toEqual({
      status: "succeeded",
      id: "ui.screen",
      output: { tabs: [{ tab: "tab.a", ...FAKE_TAB_SCREEN }] },
    });
    const navigated = await invoke(ctx, { id: "ui.navigate", input: { route: "/canvas" } });
    expect(navigated).toEqual({
      status: "succeeded",
      id: "ui.navigate",
      output: { outcome: "applied", tab: "tab.a" },
    });
  });
});

describe("screen state with no kb ui", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-screens-none-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("a server removes .kb/ui.json when it stops", async () => {
    const presence = join(root, ".kb", "ui.json");
    const handle = await run(startUi({ root, port: 0, openBrowser: false }));
    expect(existsSync(presence)).toBe(true);
    await run(handle.stop);
    expect(existsSync(presence)).toBe(false);
  });

  test("a root nobody serves has no tabs, and a command there is no-tab", async () => {
    const ctx = await openKb(root);
    expect(await invoke(ctx, { id: "ui.screen", input: {} })).toEqual({
      status: "succeeded",
      id: "ui.screen",
      output: { tabs: [] },
    });
    expect(await invoke(ctx, { id: "ui.select", input: { tab: "tab.a", focus: "n.x" } })).toEqual({
      status: "succeeded",
      id: "ui.select",
      output: { outcome: "no-tab", tab: "tab.a" },
    });
  });

  test("a presence file left by a server that died names no tabs", async () => {
    const ctx = await openKb(root);
    // Bind and release a port, so nothing listens where the file points.
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const url = `http://127.0.0.1:${probe.port}`;
    void probe.stop(true);
    await writeFile(join(root, ".kb", "ui.json"), JSON.stringify({ url }));
    expect(await invoke(ctx, { id: "ui.navigate", input: { node: "n.x" } })).toEqual({
      status: "succeeded",
      id: "ui.navigate",
      output: { outcome: "no-tab" },
    });
  });
});
