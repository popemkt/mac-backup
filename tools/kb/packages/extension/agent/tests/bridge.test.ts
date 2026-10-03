/**
 * The bridge over a scripted runtime and a stand-in `kb ui` host: what a
 * turn is given, what the sidebar hears, and how a call runs by its mode.
 * The real server, the real invoke core and the approval round trip through
 * `POST /api/action` are the surface contract's (`agent` surface).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  ChannelPoint,
  UiHost,
  failed,
  succeeded,
  type ActionInvocation,
  type ActionReceipt,
  type Channel,
  type ChannelPeer,
  type ManifestEntry,
  type TabScreen,
  type UiHostService,
} from "@kb/contracts";
import { definePlugin, makeKernel, type Kernel } from "@kb/plugin";
import {
  AGENT_CHANNEL,
  AGENT_SYSTEM_PROMPT,
  AgentEventSchema,
  MAX_CONVERSATIONS_PER_CONNECTION,
  agentPlugin,
  scriptedRuntime,
  type AgentEvent,
  type ScriptStep,
  type ScriptedRuntime,
} from "../src/index.ts";

const READ: ManifestEntry = {
  id: "node.get",
  title: "Get node",
  description: "",
  mode: { kind: "read" },
  inputSchema: {},
  outputSchema: {},
};
const GATED: ManifestEntry = {
  id: "ext.gated.stamp",
  title: "Stamp",
  description: "",
  mode: { kind: "write", approval: "required" },
  inputSchema: {},
  outputSchema: {},
};

const SCREEN: TabScreen = {
  tab: "tab.a",
  route: "/",
  active: true,
  activePane: "main",
  panes: [
    {
      id: "main",
      route: "/",
      view: { key: "outline.main", subject: "n.root" },
      focused: "n.focus",
      selection: ["n.focus", "item.not-a-node"],
    },
  ],
};

/** A host whose registry is two actions and whose one tab is `tab.a`. */
function fakeHost(invoked: ActionInvocation[]): UiHostService {
  const texts: Record<string, string> = { "n.root": "Root", "n.focus": "Focused" };
  return {
    root: "/tmp/fake-root",
    manifest: Effect.succeed([READ, GATED]),
    invoke: (invocation) =>
      Effect.sync((): ActionReceipt => {
        invoked.push(invocation);
        if (invocation.id === "ui.screen") return succeeded("ui.screen", { tabs: [SCREEN] });
        const input = invocation.input as { id?: string };
        const text = input.id === undefined ? undefined : texts[input.id];
        if (invocation.id === "node.get" && text !== undefined) {
          return succeeded("node.get", { node: { id: input.id, text } });
        }
        return failed(invocation.id, "not_found", `nothing at ${input.id ?? "?"}`);
      }),
  };
}

interface Harness {
  readonly kernel: Kernel;
  readonly channel: Channel;
  readonly runtime: ScriptedRuntime;
  readonly invoked: ActionInvocation[];
}

function harness(script: (text: string) => readonly ScriptStep[]): Harness {
  const invoked: ActionInvocation[] = [];
  const runtime = scriptedRuntime((turn) => script(turn.message.text));
  const kernel = makeKernel();
  Effect.runSync(
    kernel.load(
      definePlugin({ name: "host", apply: (ctx) => ctx.provide(UiHost, fakeHost(invoked)) }),
    ),
  );
  Effect.runSync(kernel.load(agentPlugin({ runtime })));
  const channel = kernel.lookup(ChannelPoint, AGENT_CHANNEL)?.value;
  if (channel === undefined) throw new Error("the agent plugin owns no channel");
  return { kernel, channel, runtime, invoked };
}

/** A connection that records what the bridge sends it. */
class Peer implements ChannelPeer {
  readonly heard: AgentEvent[] = [];
  readonly connection: string;
  readonly tab: () => string | null;
  constructor(connection: string, tab: string | null = "tab.a") {
    this.connection = connection;
    this.tab = () => tab;
  }
  readonly send = (data: unknown) =>
    Effect.sync(() => void this.heard.push(AgentEventSchema.parse(data)));

  say(channel: Channel, data: unknown): Promise<void> {
    return Effect.runPromise(channel.receive(this, data));
  }

  /** The first event `pred` accepts, waiting up to two seconds for it. */
  async next(pred: (event: AgentEvent) => boolean): Promise<AgentEvent> {
    const deadline = Date.now() + 2000;
    for (;;) {
      const found = this.heard.find(pred);
      if (found !== undefined) return found;
      if (Date.now() > deadline)
        throw new Error(`never heard it; heard ${JSON.stringify(this.heard)}`);
      await Bun.sleep(5);
    }
  }

  turnEnd(): Promise<AgentEvent> {
    return this.next((event) => event.type === "turn-end");
  }
}

const kernels: Kernel[] = [];
afterEach(async () => {
  await Effect.runPromise(Effect.forEach(kernels.splice(0), (k) => k.shutdown, { discard: true }));
});

function open(script: (text: string) => readonly ScriptStep[]): Harness {
  const h = harness(script);
  kernels.push(h.kernel);
  return h;
}

describe("the agent bridge", () => {
  test("a turn gets the prompt, the sender's screen, every action and the last session", async () => {
    const h = open(() => [{ say: "Hello" }, { say: ", there" }]);
    const peer = new Peer("c1");
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "hi" });
    expect(await peer.turnEnd()).toEqual({ type: "turn-end", conversation: "k1", outcome: "done" });
    expect(peer.heard.filter((event) => event.type === "text")).toEqual([
      { type: "text", conversation: "k1", delta: "Hello" },
      { type: "text", conversation: "k1", delta: ", there" },
    ]);
    const [first] = h.runtime.turns;
    expect(first?.system).toBe(AGENT_SYSTEM_PROMPT);
    expect(first?.message.text).toBe("hi");
    expect(first?.resume).toBeUndefined();
    expect(first?.tools.map((tool) => tool.id)).toEqual(["node.get", "ext.gated.stamp"]);
    const screen = JSON.parse(first?.message.screen ?? "null") as Record<string, unknown>;
    expect(screen).toMatchObject({ tab: "tab.a", route: "/" });
    // The nodes the screen mentions are named; an id that is no node is not.
    expect(screen["names"]).toEqual({ "n.root": "Root", "n.focus": "Focused" });

    peer.heard.length = 0;
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "again" });
    await peer.turnEnd();
    expect(h.runtime.turns[1]?.resume).toBe("scripted-1");
  });

  test("a sender that is no tab sends no screen", async () => {
    const h = open(() => []);
    const peer = new Peer("c1", null);
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "hi" });
    await peer.turnEnd();
    expect(h.runtime.turns[0]?.message.screen).toBeNull();
  });

  test("a call that needs no approval runs at once through the host", async () => {
    const seen: ActionReceipt[] = [];
    const h = open(() => [
      {
        call: "node.get",
        input: { id: "n.root", depth: 0 },
        answer: (receipt) => (seen.push(receipt), "read it"),
      },
    ]);
    const peer = new Peer("c1");
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "read" });
    await peer.turnEnd();
    const call = await peer.next((event) => event.type === "tool-call");
    expect(call).toMatchObject({ action: "node.get", title: "Get node", approval: false });
    const result = await peer.next((event) => event.type === "tool-result");
    const receipt = succeeded("node.get", { node: { id: "n.root", text: "Root" } });
    expect(result).toMatchObject({ call: (call as { call: string }).call, receipt });
    expect(seen).toEqual([receipt]);
    expect(h.invoked).toContainEqual({ id: "node.get", input: { id: "n.root", depth: 0 } });
  });

  test("an approval-required call waits for the person's receipt and never runs on the host", async () => {
    const seen: ActionReceipt[] = [];
    const h = open(() => [
      { call: "ext.gated.stamp", answer: (receipt) => (seen.push(receipt), "stamped") },
    ]);
    const peer = new Peer("c1");
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "stamp" });
    const call = await peer.next((event) => event.type === "tool-call");
    expect(call).toMatchObject({ action: "ext.gated.stamp", approval: true });
    const id = (call as { call: string }).call;

    // A receipt of another action, or for a call nobody waits on, is refused.
    await peer.say(h.channel, {
      type: "receipt",
      conversation: "k1",
      call: id,
      receipt: succeeded("node.get", {}),
    });
    await peer.say(h.channel, {
      type: "receipt",
      conversation: "k1",
      call: "nobody",
      receipt: succeeded("ext.gated.stamp", {}),
    });
    expect(peer.heard.filter((event) => event.type === "refused")).toHaveLength(2);

    const approved = succeeded("ext.gated.stamp", { stamped: true });
    await peer.say(h.channel, { type: "receipt", conversation: "k1", call: id, receipt: approved });
    await peer.turnEnd();
    expect(seen).toEqual([approved]);
    expect(await peer.next((event) => event.type === "tool-result")).toMatchObject({
      call: id,
      receipt: approved,
    });
    expect(h.invoked.some((invocation) => invocation.id === "ext.gated.stamp")).toBe(false);
  });

  test("cancel stops a turn, a call waiting for the person included", async () => {
    const h = open((text) => (text === "wait" ? [{ call: "ext.gated.stamp" }] : [{ hang: true }]));
    const peer = new Peer("c1");
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "hang" });
    await peer.say(h.channel, { type: "cancel", conversation: "k1" });
    expect(await peer.turnEnd()).toMatchObject({ outcome: "cancelled" });

    peer.heard.length = 0;
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "wait" });
    const call = await peer.next((event) => event.type === "tool-call");
    await peer.say(h.channel, { type: "cancel", conversation: "k1" });
    expect(await peer.turnEnd()).toMatchObject({ outcome: "cancelled" });
    // Nothing waits for that call any more.
    await peer.say(h.channel, {
      type: "receipt",
      conversation: "k1",
      call: (call as { call: string }).call,
      receipt: succeeded("ext.gated.stamp", {}),
    });
    expect(await peer.next((event) => event.type === "refused")).toBeDefined();
  });

  test("a runtime failure ends the turn as failed, with its message", async () => {
    const h = open(() => [{ say: "trying" }, { fail: "not logged in" }]);
    const peer = new Peer("c1");
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "hi" });
    expect(await peer.turnEnd()).toEqual({
      type: "turn-end",
      conversation: "k1",
      outcome: "failed",
      message: "not logged in",
    });
  });

  test("one turn at a time, one connection per conversation, and a bad frame is refused", async () => {
    const h = open(() => [{ hang: true }]);
    const peer = new Peer("c1");
    const other = new Peer("c2");
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "one" });
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "two" });
    expect(await peer.next((event) => event.type === "refused")).toMatchObject({
      reason: "a turn is already running",
    });
    await other.say(h.channel, { type: "cancel", conversation: "k1" });
    expect(await other.next((event) => event.type === "refused")).toMatchObject({
      reason: "another connection holds this conversation",
    });
    await other.say(h.channel, { type: "nonsense" });
    expect(other.heard.filter((event) => event.type === "refused")).toHaveLength(2);
    expect(h.runtime.turns).toHaveLength(1);
  });

  test("a closed connection's conversations stop and are forgotten", async () => {
    const h = open(() => [{ hang: true }]);
    const peer = new Peer("c1");
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "one" });
    await Effect.runPromise(h.channel.drop("c1"));
    await peer.turnEnd();
    // Forgotten: another connection may now start that conversation afresh.
    const other = new Peer("c2");
    await other.say(h.channel, { type: "send", conversation: "k1", text: "two" });
    expect(other.heard.some((event) => event.type === "refused")).toBe(false);
    expect(h.runtime.turns.at(-1)?.resume).toBeUndefined();
  });

  test("a connection holds a bounded number of conversations: the least recently used closes", async () => {
    const h = open((text) => (text === "wait" ? [{ call: "ext.gated.stamp" }] : [{ hang: true }]));
    const peer = new Peer("c1");
    const cap = MAX_CONVERSATIONS_PER_CONNECTION;
    // k0 waits on the person; the rest hang. Speaking in k1 again makes k0 the oldest.
    await peer.say(h.channel, { type: "send", conversation: "k0", text: "wait" });
    const call = (await peer.next((event) => event.type === "tool-call")) as { call: string };
    for (let i = 1; i < cap; i++) {
      await peer.say(h.channel, { type: "send", conversation: `k${i}`, text: "hang" });
    }
    await peer.say(h.channel, { type: "cancel", conversation: "k1" });
    await peer.say(h.channel, { type: "send", conversation: "k1", text: "again" });
    expect(
      peer.heard.some((event) => event.type === "turn-end" && event.conversation === "k0"),
    ).toBe(false);

    await peer.say(h.channel, { type: "send", conversation: "extra", text: "hang" });
    expect(
      await peer.next((event) => event.type === "turn-end" && event.conversation === "k0"),
    ).toMatchObject({ outcome: "cancelled" });
    // Its pending approval went with it: nothing waits for that call any more.
    await peer.say(h.channel, {
      type: "receipt",
      conversation: "k0",
      call: call.call,
      receipt: succeeded("ext.gated.stamp", {}),
    });
    expect(peer.heard.at(-1)).toMatchObject({ type: "refused" });
    // The others still run: only the surplus closed.
    expect(
      peer.heard.filter((event) => event.type === "turn-end" && event.conversation !== "k0"),
    ).toHaveLength(1);
    // Another connection's conversations are not counted against this one.
    const other = new Peer("c2");
    await other.say(h.channel, { type: "send", conversation: "o1", text: "hang" });
    expect(other.heard.some((event) => event.type === "refused")).toBe(false);
    // A closed conversation's id starts afresh.
    await peer.say(h.channel, { type: "send", conversation: "k0", text: "hang" });
    expect(h.runtime.turns.at(-1)?.resume).toBeUndefined();
  });
});
