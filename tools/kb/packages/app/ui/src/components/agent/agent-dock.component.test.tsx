/**
 * The agent dock over stand-in ports: what the channel says is drawn as it
 * streams, and the person's approve or decline is a call through the invoke
 * path with `approved` set to their answer, whose receipt goes back to the
 * agent. The bridge and the real invoke core are `@kb/agent`'s and the
 * surface contract's.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { failed, succeeded, type ActionInvocation, type ActionReceipt } from "@kb/contracts";
import type { AgentEvent, AgentRequest } from "@kb/agent";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { attachChat, useChat, type AgentPorts } from "./chat";
import { AgentDock } from "./surfaces";

interface Stand {
  readonly ports: AgentPorts;
  readonly sent: AgentRequest[];
  readonly invoked: ActionInvocation[];
  /** Say `event` on the channel, as the bridge would. */
  hear: (event: AgentEvent) => void;
  /** The socket opens or closes. */
  socket: (open: boolean) => void;
}

function stand(answer: (invocation: ActionInvocation) => ActionReceipt): Stand {
  const sent: AgentRequest[] = [];
  const invoked: ActionInvocation[] = [];
  let sink: ((data: unknown) => void) | null = null;
  let socket: ((open: boolean) => void) | null = null;
  return {
    sent,
    invoked,
    hear: (event) => act(() => sink?.(event)),
    socket: (open) => act(() => socket?.(open)),
    ports: {
      listen: (next) => {
        sink = next.data;
        return () => (sink = null);
      },
      send: (request) => void sent.push(request),
      connection: (listener) => {
        socket = listener;
        return () => (socket = null);
      },
      invoke: (invocation) => {
        invoked.push(invocation);
        return Promise.resolve(answer(invocation));
      },
      newConversation: () => "k1",
    },
  };
}

describe("the agent dock", () => {
  let installed: InstalledDom;
  let container: HTMLElement;
  let root: Root;
  let detach: () => void;

  beforeAll(() => {
    installed = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => installed.restore());

  function open(s: Stand): void {
    detach = attachChat(s.ports);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(AgentDock, { onClose: () => undefined })));
  }

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    detach();
  });

  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === name || b.getAttribute("aria-label") === name,
    );

  async function type(text: string): Promise<void> {
    const area = container.querySelector("textarea");
    if (area === null) throw new Error("no composer");
    await act(async () => {
      area.value = text;
      area.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }

  it("sends a message and draws the reply as it streams", async () => {
    const s = stand(() => succeeded("x", {}));
    open(s);
    expect(container.textContent).toContain("Ask about what is on your screen.");
    await type("what is this?");
    act(() => button("Send")?.click());
    expect(s.sent).toEqual([{ type: "send", conversation: "k1", text: "what is this?" }]);
    expect(button("Stop the agent")).toBeDefined();
    s.hear({ type: "text", conversation: "k1", delta: "It is " });
    s.hear({ type: "text", conversation: "k1", delta: "a node." });
    expect(container.textContent).toContain("It is a node.");
    s.hear({ type: "turn-end", conversation: "k1", outcome: "done" });
    expect(button("Stop the agent")).toBeUndefined();
  });

  it("approving makes the call with approval, and its receipt goes back to the agent", async () => {
    const stamped = succeeded("ext.gated.stamp", { stamped: true });
    const s = stand(() => stamped);
    open(s);
    s.hear({
      type: "tool-call",
      conversation: "k1",
      call: "c1",
      action: "ext.gated.stamp",
      title: "Stamp",
      input: { n: 1 },
    });
    s.hear({ type: "approval", conversation: "k1", call: "c1" });
    expect(container.textContent).toContain("Approve Stamp?");
    await act(async () => button("Approve")?.click());
    expect(s.invoked).toEqual([
      { id: "ext.gated.stamp", input: { n: 1 }, approved: true, actor: "agent" },
    ]);
    expect(s.sent).toContainEqual({
      type: "receipt",
      conversation: "k1",
      call: "c1",
      receipt: stamped,
    });
    s.hear({ type: "tool-result", conversation: "k1", call: "c1", receipt: stamped });
    expect(container.textContent).toContain("You approved this.");
    expect(button("Approve")).toBeUndefined();
  });

  it("declining makes the same call without approval, so the invoke core refuses it", async () => {
    const refused = failed("ext.gated.stamp", "approval_required", "needs approval");
    const s = stand((invocation) =>
      invocation.approved === true ? succeeded(invocation.id, {}) : refused,
    );
    open(s);
    s.hear({
      type: "tool-call",
      conversation: "k1",
      call: "c1",
      action: "ext.gated.stamp",
      title: "Stamp",
      input: {},
    });
    s.hear({ type: "approval", conversation: "k1", call: "c1" });
    await act(async () => button("Decline")?.click());
    expect(s.invoked).toEqual([
      { id: "ext.gated.stamp", input: {}, approved: false, actor: "agent" },
    ]);
    expect(s.sent.at(-1)).toEqual({
      type: "receipt",
      conversation: "k1",
      call: "c1",
      receipt: refused,
    });
    s.hear({ type: "tool-result", conversation: "k1", call: "c1", receipt: refused });
    expect(container.textContent).toContain("You declined this.");
  });

  it("a dropped socket stops the turn and says so; a server with no agent says that", async () => {
    const s = stand(() => succeeded("x", {}));
    open(s);
    await type("hi");
    act(() => button("Send")?.click());
    s.socket(false);
    expect(useChat.getState().transcript.running).toBe(false);
    expect(container.textContent).toContain("Not connected to kb.");
    s.socket(true);
    expect(container.textContent).not.toContain("Not connected to kb.");
  });
});
