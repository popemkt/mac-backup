/**
 * The page's end of the sandbox bridge: it hears only its own frame, answers
 * the handshake and hands over the run and where its view's things are,
 * hands tool calls to the invoke core as the script's, with what its run
 * may reach, and cuts off a frame that floods the page or leaves its
 * document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { succeeded, type ActionInvocation } from "@kb/contracts";
import { ENGINE_LIMITS, type RunStatus } from "@kb/sandbox";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import type { SandboxRun } from "@kb/ui-sdk";
import { hostSandboxFrame } from "./sandbox-host";

const RUN: SandboxRun = {
  input: {
    code: "kb.draw(1)",
    subject: "n.s",
    events: ["canvas.selection", "data"],
    engine: "quickjs",
    limits: ENGINE_LIMITS.quickjs,
  },
  grant: { reads: "subject", actions: [] },
};

let dom: InstalledDom;
beforeEach(() => {
  dom = installDomGlobals();
});
afterEach(() => dom.restore());

/** A frame whose window records what the page posts it. */
function fakeFrame() {
  const posted: unknown[] = [];
  const contentWindow = { postMessage: (message: unknown) => posted.push(message) };
  const listeners = new Map<string, () => void>();
  const frame = {
    contentWindow,
    src: "/sandbox",
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  return { frame, posted, contentWindow, load: () => listeners.get("load")?.() };
}

function setup() {
  const fake = fakeFrame();
  const calls: ActionInvocation[] = [];
  const statuses: RunStatus[] = [];
  const hosted = hostSandboxFrame(
    fake.frame as unknown as HTMLIFrameElement,
    RUN,
    {
      invoke: (invocation) => {
        calls.push(invocation);
        return Promise.resolve(succeeded(invocation.id, { node: { id: "n.s" } }));
      },
    },
    { status: (status) => statuses.push(status), log: () => {} },
  );
  const from = (source: unknown, data: unknown) =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", { data, source: source as never }),
    );
  return {
    ...fake,
    calls,
    statuses,
    hosted,
    frameSays: (data: unknown) => from(fake.contentWindow, data),
    from,
  };
}

const initialize = { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} };
const initialized = { jsonrpc: "2.0", method: "ui/notifications/initialized" };

describe("the page as a sandbox frame's host", () => {
  it("answers the handshake, then hands the frame its run", () => {
    const { frameSays, posted } = setup();
    frameSays(initialize);
    expect(posted[0]).toMatchObject({
      id: 1,
      result: { protocolVersion: "2026-01-26", hostCapabilities: { serverTools: {} } },
    });
    frameSays(initialized);
    expect(posted[1]).toEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: RUN.input },
    });
  });

  it("hands the frame an event its run hears once it is up, none before, and never one it does not", () => {
    const { frameSays, posted, hosted } = setup();
    hosted.event({ type: "data", target: null });
    expect(posted).toEqual([]);
    frameSays(initialize);
    frameSays(initialized);
    hosted.event({ type: "canvas.selection", target: null, value: "a" });
    expect(posted.at(-1)).toEqual({
      jsonrpc: "2.0",
      method: "kb/event",
      params: { type: "canvas.selection", target: null, value: "a" },
    });
    const before = posted.length;
    hosted.event({ type: "click", target: "x" });
    expect(posted).toHaveLength(before);
  });

  it("tells the frame where its view's things are: the last told once it is up, then each change", () => {
    const { frameSays, posted, hosted } = setup();
    const here = { a: { left: 1, top: 2, right: 3, bottom: 4 } };
    hosted.anchor({ gone: { left: 0, top: 0, right: 1, bottom: 1 } });
    hosted.anchor(here);
    expect(posted).toEqual([]);
    frameSays(initialize);
    frameSays(initialized);
    expect(posted.slice(1)).toEqual([
      expect.objectContaining({ method: "ui/notifications/tool-input" }),
      { jsonrpc: "2.0", method: "kb/anchors", params: { anchors: here } },
    ]);
    hosted.anchor({});
    expect(posted.at(-1)).toEqual({
      jsonrpc: "2.0",
      method: "kb/anchors",
      params: { anchors: {} },
    });
  });

  it("hears nothing from any window but its frame's", () => {
    const { from, posted } = setup();
    from({ postMessage: () => {} }, initialize);
    from(null, initialize);
    expect(posted).toEqual([]);
  });

  it("hands a tool call to the invoke core as the script's, with what its run may reach", async () => {
    const { frameSays, posted, calls } = setup();
    frameSays({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "node.get", arguments: { id: "n.s" } },
    });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    // The core decides the call against its grant and subject; the page only stamps them.
    expect(calls).toEqual([
      {
        id: "node.get",
        input: { id: "n.s" },
        actor: "script",
        script: { subject: "n.s", grant: RUN.grant },
      },
    ]);
  });

  it("cuts off a frame that floods the page", () => {
    const { frameSays, statuses, frame } = setup();
    for (let i = 0; i < 401; i++)
      frameSays({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "info", data: "x" },
      });
    expect(statuses.at(-1)).toMatchObject({ state: "ended", end: { reason: "error" } });
    expect(frame.src).toBe("about:blank");
  });

  it("cuts off a frame that loads another document after it initialized", () => {
    const { frameSays, statuses, load, posted } = setup();
    load();
    expect(statuses).toEqual([]);
    frameSays(initialize);
    frameSays(initialized);
    load();
    expect(statuses.at(-1)).toMatchObject({ state: "ended" });
    const before = posted.length;
    frameSays(initialize);
    expect(posted).toHaveLength(before);
  });
});
