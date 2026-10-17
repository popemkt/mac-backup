/**
 * Which provider runs a turn (`DESIGN.md` → Agent packages → providers): the
 * agent's node selects an `#agent-provider` node, read when each turn
 * starts; the provider's settings reach its adapter as written; a provider
 * that changes starts its conversation afresh, saying so; a provider that
 * binds a key, an endpoint or an executable runs only once a person trusted
 * that binding here, and its adapter resolves that key and no other; and a
 * credential is resolved through the host's secret source, never stored.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  ChannelPoint,
  NO_SECRETS,
  SecretError,
  UiHost,
  failed,
  succeeded,
  type ActionReceipt,
  type Channel,
  type ChannelPeer,
  type SecretSource,
  type WireNode,
} from "@kb/contracts";
import { SYSTEM_IDS, extensionNodeId } from "@kb/model";
import { providerDigest } from "@kb/sandbox";
import { definePlugin, makeKernel, type Kernel } from "@kb/plugin";
import {
  AGENT_CHANNEL,
  AGENT_IDS,
  AgentEventSchema,
  DEFAULT_ADAPTER,
  DEFAULT_PROVIDER,
  adapterOptionId,
  agentPlugin,
  resolveCredential,
  scriptedRuntime,
  type AgentAdapter,
  type AgentEvent,
  type ProviderConfig,
  type ScriptedRuntime,
} from "../src/index.ts";

const AGENT_NODE = extensionNodeId("agent");
const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

const str = (v: string) => [{ t: "str" as const, v }];
const ref = (v: string) => [{ t: "ref" as const, v }];

/** A provider node's settings as a person writes them, with no kind. */
function settings(model: string): WireNode["props"] {
  return {
    [AGENT_IDS.adapterField]: ref(adapterOptionId(DEFAULT_ADAPTER)),
    [AGENT_IDS.modelField]: str(model),
    [AGENT_IDS.endpointField]: str("http://127.0.0.1:8317"),
    [AGENT_IDS.credentialField]: str("env:PROXY_KEY"),
  };
}

/** A provider node as a person writes one. */
function provider(id: string, text: string, model: string): WireNode {
  return node(id, text, { [SYSTEM_IDS.typeField]: ref(AGENT_IDS.providerTag), ...settings(model) });
}

/** Select `id` on the agent's node, or clear the selection. */
function select(store: Map<string, WireNode>, id: string | null): void {
  store.set(
    AGENT_NODE,
    node(AGENT_NODE, "Agent", id === null ? {} : { [AGENT_IDS.providerField]: ref(id) }),
  );
}

interface Rig {
  readonly channel: Channel;
  readonly store: Map<string, WireNode>;
  /** What each runtime the adapter built was built from, in order. */
  readonly built: ProviderConfig[];
  /** The secret source each runtime was built with, in order. */
  readonly sources: SecretSource[];
  readonly runtimes: ScriptedRuntime[];
}

const kernels: Kernel[] = [];
afterEach(async () => {
  await Effect.runPromise(Effect.forEach(kernels.splice(0), (k) => k.shutdown, { discard: true }));
});

/**
 * A host whose store is `store`, and an agent over one recording adapter (or
 * none); `trusted` is the digests a person trusted here, every one unless
 * it says.
 */
function rig(adapters: "one" | "none" = "one", trusted?: ReadonlySet<string>): Rig {
  const store = new Map<string, WireNode>();
  const built: ProviderConfig[] = [];
  const sources: SecretSource[] = [];
  const runtimes: ScriptedRuntime[] = [];
  const adapter: AgentAdapter = {
    id: DEFAULT_ADAPTER,
    runtime: (config, secrets) => {
      built.push(config);
      sources.push(secrets);
      const runtime = scriptedRuntime(() => [{ say: "ok" }]);
      runtimes.push(runtime);
      return runtime;
    },
  };
  const kernel = makeKernel();
  kernels.push(kernel);
  const host = {
    root: "/tmp/fake-root",
    invoke: (invocation: { readonly id: string; readonly input: unknown }) =>
      Effect.sync((): ActionReceipt => {
        if (invocation.id === "kb.manifest")
          return succeeded("kb.manifest", { actions: [], views: [] });
        if (invocation.id === "ui.screen") return succeeded("ui.screen", { tabs: [] });
        if (invocation.id === "sandbox.trusted") {
          const { digests } = invocation.input as { digests: string[] };
          return succeeded("sandbox.trusted", {
            trusted: digests.filter((digest) => trusted?.has(digest) ?? true),
          });
        }
        const id = (invocation.input as { id?: string }).id ?? "";
        const found = store.get(id);
        if (invocation.id === "node.get" && found !== undefined) {
          return succeeded("node.get", { node: found });
        }
        return failed(invocation.id, "not_found", `nothing at ${id}`);
      }),
  };
  Effect.runSync(
    kernel.load(definePlugin({ name: "host", apply: (ctx) => ctx.provide(UiHost, host) })),
  );
  Effect.runSync(
    kernel.load(agentPlugin({ adapters: adapters === "one" ? [adapter] : [], secrets: SECRETS })),
  );
  const channel = kernel.lookup(ChannelPoint, AGENT_CHANNEL)?.value;
  if (channel === undefined) throw new Error("the agent plugin owns no channel");
  return { channel, store, built, sources, runtimes };
}

class Peer implements ChannelPeer {
  readonly heard: AgentEvent[] = [];
  readonly connection = "c1";
  readonly tab = () => null;
  readonly send = (data: unknown) =>
    Effect.sync(() => void this.heard.push(AgentEventSchema.parse(data)));

  /** Send `text` in conversation `k1` and wait for the turn to end; the end. */
  async turn(channel: Channel, text: string): Promise<AgentEvent> {
    const ends = this.heard.filter((event) => event.type === "turn-end").length;
    await Effect.runPromise(channel.receive(this, { type: "send", conversation: "k1", text }));
    const deadline = Date.now() + 2000;
    for (;;) {
      const end = this.heard.filter((event) => event.type === "turn-end")[ends];
      if (end !== undefined) return end;
      if (Date.now() > deadline)
        throw new Error(`no turn end; heard ${JSON.stringify(this.heard)}`);
      await Bun.sleep(5);
    }
  }

  notices(): readonly string[] {
    return this.heard.flatMap((event) => (event.type === "notice" ? [event.text] : []));
  }
}

describe("the provider a turn runs on", () => {
  test("with nothing selected, the default adapter runs as it does with no settings", async () => {
    const r = rig();
    const peer = new Peer();
    expect(await peer.turn(r.channel, "hi")).toMatchObject({ outcome: "done" });
    expect(r.built).toEqual([DEFAULT_PROVIDER]);
    expect(peer.notices()).toEqual([]);
  });

  test("a selected provider's settings reach its adapter as written, the credential as its reference", async () => {
    const r = rig();
    r.store.set("n.proxy", provider("n.proxy", "Local proxy", "sonnet"));
    select(r.store, "n.proxy");
    await new Peer().turn(r.channel, "hi");
    expect(r.built).toEqual([
      {
        adapter: DEFAULT_ADAPTER,
        endpoint: "http://127.0.0.1:8317",
        credential: "env:PROXY_KEY",
        executable: null,
        model: "sonnet",
      },
    ]);
  });

  test("a provider unchanged keeps its runtime, so the conversation resumes", async () => {
    const r = rig();
    r.store.set("n.proxy", provider("n.proxy", "Local proxy", "sonnet"));
    select(r.store, "n.proxy");
    const peer = new Peer();
    await peer.turn(r.channel, "one");
    await peer.turn(r.channel, "two");
    expect(r.built).toHaveLength(1);
    expect(r.runtimes[0]?.turns.map((turn) => turn.resume)).toEqual([undefined, "scripted-1"]);
  });

  test("a provider chosen mid-conversation runs the next turn, which starts afresh and says so", async () => {
    const r = rig();
    const peer = new Peer();
    await peer.turn(r.channel, "one");
    r.store.set("n.proxy", provider("n.proxy", "Local proxy", "sonnet"));
    select(r.store, "n.proxy");
    await peer.turn(r.channel, "two");
    expect(r.runtimes).toHaveLength(2);
    expect(r.runtimes[1]?.turns[0]?.resume).toBeUndefined();
    expect(peer.notices()).toEqual([
      "Local proxy runs this conversation now, so it starts afresh.",
    ]);
    // Its model changed is a provider changed, too: a resume handle is the old model's.
    r.store.set("n.proxy", provider("n.proxy", "Local proxy", "opus"));
    await peer.turn(r.channel, "three");
    expect(r.built.map(({ model }) => model)).toEqual([null, "sonnet", "opus"]);
    expect(r.runtimes[2]?.turns[0]?.resume).toBeUndefined();
  });

  test("a selection naming no node fails the turn, saying what to do", async () => {
    const r = rig();
    select(r.store, "n.gone");
    expect(await new Peer().turn(r.channel, "hi")).toMatchObject({
      outcome: "failed",
      message:
        "The selected provider n.gone is not in this kb; choose another, or clear the selection.",
    });
  });

  test("a node that is no #agent-provider is never read as one, whatever its settings", async () => {
    const r = rig();
    r.store.set("n.forged", node("n.forged", "Forged", settings("forged-model")));
    select(r.store, "n.forged");
    expect(await new Peer().turn(r.channel, "hi")).toMatchObject({
      outcome: "failed",
      message:
        "The selected node n.forged is not an #agent-provider; tag it as one, or choose another.",
    });
    expect(r.built).toEqual([]);
  });

  test("a provider that binds a key and an endpoint runs only once that binding is trusted here", async () => {
    const trusted = new Set<string>();
    const r = rig("one", trusted);
    r.store.set("n.proxy", provider("n.proxy", "Local proxy", "sonnet"));
    select(r.store, "n.proxy");
    const binding = {
      adapter: DEFAULT_ADAPTER,
      endpoint: "http://127.0.0.1:8317",
      credential: "env:PROXY_KEY",
      executable: null,
    };
    const digest = await Effect.runPromise(providerDigest(binding));
    // What the person checks: the key and where it goes, together.
    expect(await new Peer().turn(r.channel, "hi")).toMatchObject({
      outcome: "failed",
      message:
        "Local proxy sends the environment variable PROXY_KEY to http://127.0.0.1:8317: " +
        `not trusted on this machine (${digest}). Trust it with sandbox.trust once you have checked them.`,
    });
    expect(r.built).toEqual([]);
    trusted.add(digest);
    expect(await new Peer().turn(r.channel, "hi")).toMatchObject({ outcome: "done" });
    // Another endpoint for the same key is a binding nobody trusted.
    r.store.set("n.proxy", {
      ...provider("n.proxy", "Local proxy", "sonnet"),
      props: {
        ...provider("n.proxy", "Local proxy", "sonnet").props,
        [AGENT_IDS.endpointField]: str("https://elsewhere.example/v1"),
      },
    });
    expect(await new Peer().turn(r.channel, "hi")).toMatchObject({
      outcome: "failed",
      message: expect.stringContaining("to https://elsewhere.example/v1: not trusted"),
    });
  });

  test("a trusted provider's adapter resolves its own key and no other", async () => {
    const r = rig();
    r.store.set("n.proxy", provider("n.proxy", "Local proxy", "sonnet"));
    select(r.store, "n.proxy");
    await new Peer().turn(r.channel, "hi");
    const [source] = r.sources;
    if (source === undefined) throw new Error("no runtime was built");
    expect(await Effect.runPromise(source.resolve({ kind: "env", name: "PROXY_KEY" }))).toBe(
      "sk-from-env",
    );
    const other = await Effect.runPromise(
      Effect.flip(source.resolve({ kind: "env", name: "HOME" })),
    );
    expect(other.message).toBe(
      "the environment variable HOME: not the key this provider is trusted to send",
    );
  });

  test("a provider whose adapter this host lacks fails the turn, naming the adapter", async () => {
    const r = rig("none");
    expect(await new Peer().turn(r.channel, "hi")).toMatchObject({
      outcome: "failed",
      message: "This kb ui has no Claude Agent SDK adapter.",
    });
  });
});

const SECRETS: SecretSource = {
  resolve: (secret) =>
    secret.kind === "env" && secret.name === "PROXY_KEY"
      ? Effect.succeed("sk-from-env")
      : Effect.fail(new SecretError({ message: "not set" })),
};

/** What resolving `credential` answers: the key, or the failure's message. */
function resolved(credential: string | null, source: SecretSource = SECRETS) {
  return Effect.runPromise(
    resolveCredential(credential, source).pipe(
      Effect.match({ onSuccess: (key) => ({ key }), onFailure: ({ message }) => ({ message }) }),
    ),
  );
}

describe("a provider's credential", () => {
  test("none written is no key: the adapter runs under the person's own login", async () => {
    expect(await resolved(null)).toEqual({ key: undefined });
  });

  test("a reference is resolved through the host's secret source, when a turn needs it", async () => {
    expect(await resolved("env:PROXY_KEY")).toEqual({ key: "sk-from-env" });
  });

  test("a value that is no reference is refused, and the value is not repeated", async () => {
    const answer = await resolved("sk-pasted-key");
    expect(answer).toEqual({
      message: "The provider's credential is not a secret reference (env:NAME or keychain:…).",
    });
  });

  test("a host that reads no keys fails naming the reference", async () => {
    expect(await resolved("env:PROXY_KEY", NO_SECRETS)).toEqual({
      message: "the environment variable PROXY_KEY: this process reads no keys",
    });
  });
});
