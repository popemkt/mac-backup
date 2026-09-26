/**
 * The write check (a value must fit its field's declared type) as the MCP
 * surface carries it. `runtime/tests/value-conformance.test.ts` proves the
 * check at the registry; this proves an agent calling a tool meets the same
 * refusal, as a tool error it can read, and that nothing was written.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";
import { SYSTEM_IDS, fieldTypeValue } from "@kb/model";
import { bunFileSystemLayer } from "@kb/runtime";
import { createMcpServer } from "../src/mcp.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function connected(): Promise<Client> {
  const root = await mkdtemp(join(tmpdir(), "kb-mcp-conform-"));
  roots.push(root);
  const server = await Effect.runPromise(
    createMcpServer(root).pipe(Effect.provide(bunFileSystemLayer)),
  );
  const client = new Client({ name: "kb-mcp-conform", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
  return { isError: result.isError === true, text };
}

test("a tool call that writes a string into a number field is a readable tool error", async () => {
  const client = await connected();
  await call(client, "field_define", { name: "f.estimate", id: "f.estimate" });
  await call(client, "node_update", {
    id: "f.estimate",
    setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("number") }],
  });
  await call(client, "node_add", { id: "n.task", text: "Task" });

  const refused = await call(client, "node_update", {
    id: "n.task",
    setProps: [{ field: "f.estimate", value: { t: "str", v: "banana" } }],
  });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("invalid_input");
  expect(refused.text).toContain("field f.estimate is number");

  const accepted = await call(client, "node_update", {
    id: "n.task",
    setProps: [{ field: "f.estimate", value: { t: "num", v: 3 } }],
  });
  expect(accepted.isError).toBe(false);
  const got = await call(client, "node_get", { id: "n.task" });
  expect(got.text).toContain('"f.estimate":[{"t":"num","v":3}]');
});
