// One op table, three surfaces: every op in core/ops.ts is a `bb sandbox` command, a `sandbox_*`
// agent tool and an SDK method, and the HTTP route answers them. Loads the real plugin in the
// SDK's fake host.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createFakePluginHost, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { OPS, toolName } from "../core/ops.ts";
import plugin from "../server.ts";

const load = async () => {
  const host = createFakePluginHost({ pluginId: "sandbox", agentSkillIds: ["sandbox"] });
  await plugin(host.bb);
  return host.harness;
};

test("op names, command paths and tool names are unique and well formed", () => {
  for (const key of ["name", "path", "tool"] as const) {
    const values = OPS.map((o) => (key === "name" ? o.name : key === "path" ? o.cli.path : toolName(o.name)));
    assert.equal(new Set(values).size, values.length, key);
  }
  for (const o of OPS) assert.match(toolName(o.name), /^sandbox_[a-z0-9_]+$/);
});

test("every op is a command with its own help", async () => {
  const harness = await load();
  const help = await harness.runCli(["--help"]);
  assert.equal(help.exitCode, 0);
  for (const o of OPS) {
    assert.ok(help.stdout.includes(o.cli.path), `bb sandbox ${o.cli.path} is listed`);
    const own = await harness.runCli([...o.cli.path.split(" "), "--help"]);
    assert.equal(own.exitCode, 0, o.cli.path);
    assert.match(own.stdout, /--input/);
  }
});

test("every op is an agent tool, offered only where configure says", async () => {
  const harness = await load();
  assert.deepEqual(harness.registrations.agentTools.map((t) => t.name).sort(), OPS.map((o) => toolName(o.name)).sort());
  const plain = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext());
  assert.deepEqual(plain.tools, []);
  assert.deepEqual(plain.skills, ["sandbox"]);
  const run = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ pluginMetadata: { sandboxId: "sb-1" } }));
  assert.equal(run.tools.length, OPS.length);
});

test("every op has an SDK method, and the SDK loads with Node's type stripping alone", async () => {
  // Scripts import it straight from /etc/bb-sandbox/plugin, with no build step.
  const module = await import("../sdk/index.ts");
  assert.equal(typeof module.Sandbox.create, "function");
  const sdk = await readFile(new URL("../sdk/index.ts", import.meta.url), "utf8");
  // call<T>("op", …), where T may nest generics.
  const called = new Set([...sdk.matchAll(/\bcall(?:<[^(]*>)?\("([A-Za-z]+)"/g)].map((m) => m[1]));
  assert.deepEqual(OPS.map((o) => o.name).filter((name) => !called.has(name)), [], "ops without an SDK method");
});

test("the surfaces reach the same op: status through CLI, tool and HTTP", async () => {
  const harness = await load();
  const cli = JSON.parse((await harness.runCli(["status"])).stdout);
  const tool = JSON.parse((await harness.callAgentTool("sandbox_status", {})) as string);
  const http = await (await harness.fetchHttp("POST", "/op", { body: JSON.stringify({ op: "status", input: {} }), headers: { "content-type": "application/json" } })).json();
  assert.deepEqual(tool, cli);
  assert.deepEqual(http, { ok: true, result: cli });
  assert.ok(cli.providers.bwrap, "the local provider is registered");
});

test("errors come back as errors on every surface", async () => {
  const harness = await load();
  const cli = await harness.runCli(["get", "sb-missing"]);
  assert.notEqual(cli.exitCode, 0);
  assert.match(cli.stderr, /no sandbox sb-missing/);
  const tool = await harness.callAgentTool("sandbox_get", { id: "sb-missing" });
  assert.equal(typeof tool === "object" && tool.isError, true);
  const http = await harness.fetchHttp("POST", "/op", { body: JSON.stringify({ op: "nope" }), headers: { "content-type": "application/json" } });
  assert.equal(http.status, 404);
});
