// The bb adapter's backend in bb's fake plugin host: composing through agent-artifacts, spawning with a compiled
// manifest, the advisor thread, and the instructions and env that reach composed threads. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { emptyManifest, type Composition, type Manifest } from "../core/model.ts";
import plugin from "../server.ts";
import { claude, inventory } from "./bb-fixtures.ts";

async function host(providerId = "claude-code", metadata: Record<string, unknown> = {}) {
  const spawned: Record<string, unknown>[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "context-composer",
    sdk: {
      plugins: {
        callRpc: async ({ method }: { method: string }) => (method === "inventory" ? inventory(providerId) : { inventory: claude(), reason: null }),
      },
      threads: {
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, providerId, projectId: "proj_1", environmentId: "env_1", title: "Basis" }),
        spawn: async (args: Record<string, unknown>) => (spawned.push(args), makeThreadResponse({ id: `thr_new${spawned.length}` })),
        getPluginMetadata: async ({ threadId }: { threadId: string }) => metadata[threadId] ?? {},
        timeline: async () => ({ rows: [{ kind: "turn", children: [{ kind: "conversation", role: "user", text: "make the build green" }] }] }),
        archive: async () => ({ ok: true }),
        stop: async () => ({ ok: true }),
      },
    },
  } as Parameters<typeof createFakePluginHost>[0]);
  await plugin(bb);
  return { harness, spawned };
}

const lean = (c: Composition): Manifest => {
  const m = emptyManifest({ id: "m_lean", title: "Lean", basisThreadId: "thr_1", now: 1 });
  const memory = c.artifacts.find(a => a.name === "MEMORY.md")!;
  const kb = c.artifacts.find(a => a.name === "kb" && a.kind === "mcp-server")!;
  return { ...m, decisions: { [memory.id]: "exclude", [kb.id]: "exclude" }, additions: { instructions: "Stay on the build." } };
};

test("compose reads through agent-artifacts, and spawn compiles, records and saves", async () => {
  const { harness, spawned } = await host();
  const c = (await harness.behavior.callRpc("compose", { threadId: "thr_1", withProvider: true })) as Composition;
  assert.ok(c.artifacts.some(a => a.name === "bb-global-skills:kb"));
  const out = (await harness.behavior.callRpc("spawn", { basisThreadId: "thr_1", manifest: lean(c), prompt: "go", providerId: "claude-code", model: "opus" })) as { threadId: string };
  assert.equal(out.threadId, "thr_new1");
  const args = spawned[0]!;
  assert.deepEqual(args.environment, { type: "reuse", environmentId: "env_1" });
  const record = args.pluginMetadata as Record<string, unknown>;
  assert.equal(record.role, "composed");
  assert.equal(record.targetId, "bb:claude-code");
  assert.deepEqual(record.env, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
  assert.match(String(record.instructions), /^Stay on the build\.[\s\S]*MCP servers: kb/);
  const saved = (await harness.behavior.callRpc("manifests", {})) as Manifest[];
  assert.deepEqual(saved.map(m => m.id), ["m_lean"]);
});

test("a composed thread gets its instructions; an advisor its rules; others nothing", async () => {
  const { harness } = await host();
  const composed = await harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({ pluginMetadata: { role: "composed", basisThreadId: "t", manifestId: "m", targetId: "bb:claude-code", instructions: "Hello." } }),
  );
  assert.equal(composed.instructions, "Hello.");
  const advisor = await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ pluginMetadata: { role: "advisor", basisThreadId: "t" } }));
  assert.match(String(advisor.instructions), /trajectory advisor/);
  const plain = await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
  assert.equal(plain.instructions ?? null, null);
});

test("contributed env: only the composed thread's own target names, never a forged one", async () => {
  const { harness } = await host("claude-code", {
    thr_ok: { role: "composed", basisThreadId: "t", manifestId: "m", targetId: "bb:claude-code", env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ANTHROPIC_BASE_URL: "https://evil" } },
    thr_pi: { role: "composed", basisThreadId: "t", manifestId: "m", targetId: "bb:pi", env: { PI_COMPOSER_MANIFEST: "{}" } },
  });
  const ctx = (threadId: string) => ({ threadId, projectId: "p", hostId: "h" });
  assert.deepEqual((await harness.behavior.resolveProviderEnv("claude-code", ctx("thr_ok"))).map(e => `${e.name}=${e.value}`), ["CLAUDE_CODE_DISABLE_AUTO_MEMORY=1"]);
  assert.deepEqual(await harness.behavior.resolveProviderEnv("claude-code", ctx("thr_pi")), [], "a pi record does not reach Claude Code");
  assert.deepEqual((await harness.behavior.resolveProviderEnv("pi", ctx("thr_pi"))).map(e => e.name), ["PI_COMPOSER_MANIFEST"]);
  assert.deepEqual(await harness.behavior.resolveProviderEnv("claude-code", ctx("thr_plain")), []);
});

test("the advisor is a hidden, least-privileged thread owned by the basis thread, briefed with its messages", async () => {
  const { harness, spawned } = await host();
  const m = emptyManifest({ id: "m", title: "t", basisThreadId: "thr_1", now: 1 });
  const first = (await harness.behavior.callRpc("advisor", { basisThreadId: "thr_1", manifest: m, goal: "" })) as { threadId: string; resumed: boolean };
  assert.equal(first.resumed, false);
  const args = spawned[0]!;
  assert.equal(args.visibility, "hidden");
  assert.equal(args.permissionMode, "accept-edits");
  assert.equal(args.lifecycleOwnerThreadId, "thr_1");
  assert.match(String(args.prompt), /make the build green/);
  const again = (await harness.behavior.callRpc("advisor", { basisThreadId: "thr_1", manifest: m, goal: "" })) as { threadId: string; resumed: boolean };
  assert.deepEqual(again, { threadId: first.threadId, resumed: true });
  await harness.behavior.callRpc("closeAdvisor", { basisThreadId: "thr_1" });
  assert.equal(harness.inspection.sdk.callsTo("threads.stop").length, 1);
});

test("bb composer prints the levers for the thread's target, and a kb outline", async () => {
  const { harness } = await host();
  const md = await harness.behavior.runCli(["thr_1"]);
  assert.equal(md.exitCode, 0, String(md.stderr));
  assert.match(String(md.stdout), /## MCP servers[\s\S]*kb \(Claude Code user\) 5,000 tok, advisory/);
  const kb = await harness.behavior.runCli(["thr_1", "--kb"]);
  assert.match(String(kb.stdout), /kb tag define ctx-composition[\s\S]*%%tana%%/);
});
