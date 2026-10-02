/**
 * The tools a Claude turn sees: each of the turn's actions as the MCP tool
 * `kb mcp` would list, and every call handed to the turn's `call`. The model
 * itself is not run here, since that needs the person's login.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { succeeded, type ManifestEntry } from "@kb/contracts";
import { AGENT_SYSTEM_PROMPT, type AgentTurn } from "@kb/agent";
import { kbToolServer } from "../src/tool-server.ts";

const GET: ManifestEntry = {
  id: "node.get",
  title: "Get node",
  description: "Pull a node subtree",
  mode: { kind: "read" },
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  outputSchema: {},
};
const STAMP: ManifestEntry = {
  id: "ext.gated.stamp",
  title: "Stamp",
  description: "",
  mode: { kind: "write", approval: "required" },
  inputSchema: { type: "string" },
  outputSchema: {},
};

async function connect(calls: Array<[string, unknown]>) {
  const turn: AgentTurn = {
    system: AGENT_SYSTEM_PROMPT,
    message: { text: "hi", screen: null },
    resume: undefined,
    tools: [GET, STAMP],
    call: (action, input) =>
      Effect.sync(() => {
        calls.push([action, input]);
        return succeeded(action, { ok: true });
      }),
  };
  const server = kbToolServer(turn, new AbortController().signal);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

describe("a Claude turn's tool server", () => {
  test("lists each action as kb mcp names and hints it, kept out of tool search", async () => {
    const client = await connect([]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["node_get", "ext_gated_stamp"]);
    expect(tools[0]).toMatchObject({
      inputSchema: GET.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { "anthropic/alwaysLoad": true },
    });
    // A schema whose root is no object is published as one that takes nothing.
    expect(tools[1]?.inputSchema).toEqual({ type: "object", properties: {} });
    await client.close();
  });

  test("hands every call to the turn by action id, and answers its receipt as JSON", async () => {
    const calls: Array<[string, unknown]> = [];
    const client = await connect(calls);
    const result = await client.callTool({ name: "node_get", arguments: { id: "n.a" } });
    expect(calls).toEqual([["node.get", { id: "n.a" }]]);
    expect(result).toMatchObject({ content: [{ type: "text", text: '{"ok":true}' }] });
    const unknown = await client.callTool({ name: "nope", arguments: {} });
    expect(unknown).toMatchObject({ isError: true });
    expect(calls).toHaveLength(1);
    await client.close();
  });
});
