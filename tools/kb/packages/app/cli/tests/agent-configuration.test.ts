/**
 * The agent's configuration is the owner's (DESIGN.md → Action registry →
 * Approval → configuration): a provider node, its endpoint and key
 * reference, and the selection on the agent's node decide where a key is
 * sent, so an agent writes them only with the owner's approval and
 * sandboxed code never does, while the owner's own actors (a person, the
 * command line) write them as any node. Run through the real
 * invoke core over a store opened with the bundled seed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_IDS } from "@kb/agent";
import type { ActionInvocation } from "@kb/contracts";
import { SYSTEM_IDS, extensionNodeId, type Actor } from "@kb/model";
import { invoke, openKb } from "@kb/runtime";

const PROVIDER = "n.proxy";

const addProvider = (actor: Actor, rest: Partial<ActionInvocation> = {}): ActionInvocation => ({
  id: "node.add",
  input: {
    id: PROVIDER,
    text: "Local proxy",
    props: [
      { field: SYSTEM_IDS.typeField, value: { t: "ref", v: AGENT_IDS.providerTag } },
      { field: AGENT_IDS.endpointField, value: { t: "str", v: "http://127.0.0.1:8317/v1" } },
    ],
  },
  actor,
  ...rest,
});

const pointAt = (endpoint: string, actor: Actor): ActionInvocation => ({
  id: "node.update",
  input: {
    id: PROVIDER,
    setProps: [{ field: AGENT_IDS.endpointField, value: { t: "str", v: endpoint } }],
    unsetProps: [{ field: AGENT_IDS.endpointField }],
  },
  actor,
});

const select = (actor: Actor): ActionInvocation => ({
  id: "node.update",
  input: {
    id: extensionNodeId("agent"),
    setProps: [{ field: AGENT_IDS.providerField, value: { t: "ref", v: PROVIDER } }],
  },
  actor,
});

const asks = { status: "failed", code: "approval_required", details: { writes: "configuration" } };

describe("the agent's configuration", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-agent-configuration-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("an agent makes a provider only with the owner's approval; sandboxed code never", async () => {
    const ctx = await openKb(root);
    expect(await invoke(ctx, addProvider("agent"))).toMatchObject(asks);
    for (const approved of [undefined, true]) {
      expect(await invoke(ctx, addProvider("script", { approved }))).toMatchObject({
        status: "failed",
        code: "forbidden",
        details: { writes: "configuration" },
      });
    }
    expect(ctx.index.getNode(PROVIDER)).toBeUndefined();
    expect(await invoke(ctx, addProvider("agent", { approved: true }))).toMatchObject({
      status: "succeeded",
    });
  });

  test("an agent re-points a provider, or selects one, only with the owner's approval", async () => {
    const ctx = await openKb(root);
    expect(await invoke(ctx, addProvider("cli"))).toMatchObject({ status: "succeeded" });
    expect(await invoke(ctx, pointAt("https://elsewhere.example/v1", "agent"))).toMatchObject(asks);
    expect(await invoke(ctx, select("agent"))).toMatchObject(asks);
    // Nothing was written: the endpoint is still the owner's.
    expect(ctx.index.getNode(PROVIDER)?.props[AGENT_IDS.endpointField]).toEqual([
      { t: "str", v: "http://127.0.0.1:8317/v1" },
    ]);
  });

  test("a provider's settings on a node nobody made a provider are configuration too", async () => {
    const ctx = await openKb(root);
    for (const [field, v] of [
      [AGENT_IDS.endpointField, "https://attacker.example/v1"],
      [AGENT_IDS.credentialField, "env:ANTHROPIC_API_KEY"],
      [AGENT_IDS.executableField, "/tmp/not-claude"],
      [AGENT_IDS.modelField, "any"],
    ] as const) {
      const forge: ActionInvocation = {
        id: "node.add",
        input: { text: "untagged", props: [{ field, value: { t: "str", v } }] },
        actor: "agent",
      };
      expect({ field, receipt: await invoke(ctx, forge) }).toMatchObject({ field, receipt: asks });
    }
    const adapter: ActionInvocation = {
      id: "node.add",
      input: {
        text: "untagged",
        props: [
          {
            field: AGENT_IDS.adapterField,
            value: { t: "ref", v: "sys.agent.adapter.openai-chat" },
          },
        ],
      },
      actor: "agent",
    };
    expect(await invoke(ctx, adapter)).toMatchObject(asks);
  });

  test("the owner's own actors write it as any node", async () => {
    const ctx = await openKb(root);
    expect(await invoke(ctx, addProvider("human"))).toMatchObject({ status: "succeeded" });
    expect(await invoke(ctx, pointAt("http://127.0.0.1:11434/v1", "cli"))).toMatchObject({
      status: "succeeded",
    });
    expect(await invoke(ctx, select("human"))).toMatchObject({ status: "succeeded" });
  });

  test("a node that is not configuration is the agent's to write, as before", async () => {
    const ctx = await openKb(root);
    expect(
      await invoke(ctx, { id: "node.add", input: { text: "a note" }, actor: "agent" }),
    ).toMatchObject({ status: "succeeded" });
  });
});
