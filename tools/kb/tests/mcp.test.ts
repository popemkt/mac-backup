import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/surface/mcp.ts";
import { manifest } from "../src/registry.ts";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-mcp-"));
}

describe("MCP surface", () => {
  let root: string;

  beforeEach(async () => {
    root = await tempRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("lists action tools plus kb_manifest; node_add then graph_query", async () => {
    const server = await createMcpServer(root);
    const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const listed = await client.listTools();
    const names = new Set(listed.tools.map((t) => t.name));
    expect(names.has("kb_manifest")).toBe(true);
    for (const entry of manifest()) {
      expect(names.has(entry.id.replaceAll(".", "_"))).toBe(true);
    }

    const nodeAddTool = listed.tools.find((t) => t.name === "node_add");
    expect(nodeAddTool?.annotations?.destructiveHint).toBe(true);
    expect(nodeAddTool?.annotations?.readOnlyHint).toBe(false);

    const graphQueryTool = listed.tools.find((t) => t.name === "graph_query");
    expect(graphQueryTool?.annotations?.readOnlyHint).toBe(true);

    const add = await client.callTool({
      name: "node_add",
      arguments: { text: "hello-mcp" },
    });
    expect(add.isError).toBeFalsy();
    const addText = (add.content as { type: string; text: string }[])[0]!.text;
    const added = JSON.parse(addText) as { id: string };
    expect(typeof added.id).toBe("string");

    const q = await client.callTool({
      name: "graph_query",
      arguments: {
        query: '[:find ?id :where [?e :node/id ?id] [?e :node/text "hello-mcp"]]',
      },
    });
    expect(q.isError).toBeFalsy();
    const qText = (q.content as { type: string; text: string }[])[0]!.text;
    const queried = JSON.parse(qText) as { rows: unknown[][] };
    expect(queried.rows.some((r) => r[0] === added.id)).toBe(true);

    const man = await client.callTool({ name: "kb_manifest", arguments: {} });
    expect(man.isError).toBeFalsy();
    const manText = (man.content as { type: string; text: string }[])[0]!.text;
    const manBody = JSON.parse(manText) as { id: string }[];
    expect(manBody.some((a) => a.id === "node.add")).toBe(true);

    await client.close();
    await server.close();
  });

  test("failed action returns isError with code+message, never throws", async () => {
    const server = await createMcpServer(root);
    const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const result = await client.callTool({
      name: "node_get",
      arguments: { id: "missing-node-id" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const body = JSON.parse(text) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message.length).toBeGreaterThan(0);

    await client.close();
    await server.close();
  });
});
