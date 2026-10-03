/**
 * The page's end of the sandbox bridge: it hears only its own frame, answers
 * the handshake and hands over the run, answers tool calls through the
 * capability API as the script's, and cuts off a frame that floods the page
 * or leaves its document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { succeeded, type ActionInvocation } from "@kb/contracts";
import { ENGINE_LIMITS, type RunStatus } from "@kb/sandbox";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { hostSandboxFrame, type SandboxRun } from "./sandbox-host";

const RUN: SandboxRun = {
  input: { code: "kb.draw(1)", subject: "n.s", engine: "quickjs", limits: ENGINE_LIMITS.quickjs },
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
      node: (id) =>
        id === "n.s"
          ? { id, text: "s", props: {}, children: [], createdAt: "", updatedAt: "" }
          : undefined,
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

  it("hears nothing from any window but its frame's", () => {
    const { from, posted } = setup();
    from({ postMessage: () => {} }, initialize);
    from(null, initialize);
    expect(posted).toEqual([]);
  });

  it("answers a tool call as the script's within the grant, and refuses one outside it", async () => {
    const { frameSays, posted, calls } = setup();
    frameSays({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "node.get", arguments: { id: "n.s" } },
    });
    frameSays({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "node.delete", arguments: { id: "n.s" } },
    });
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(calls).toEqual([{ id: "node.get", input: { id: "n.s" }, actor: "script" }]);
    const refused = posted.find((message) => (message as { id: number }).id === 8) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0]?.text).toContain("forbidden");
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
