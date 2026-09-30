import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { present } from "@kb/model";
import { mkdtemp, rm } from "node:fs/promises";
import { addDocsView } from "@kb/test-kit";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ACTION_META_KEY, createMcpServer } from "../src/mcp.ts";
import { Effect } from "effect";
import { manifest, bunFileSystemLayer } from "@kb/runtime";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(bunFileSystemLayer)) as Effect.Effect<A, E>);

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
    const server = await run(createMcpServer(root));
    const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const listed = await client.listTools();
    const names = new Set(listed.tools.map((t) => t.name));
    expect(names.has("kb_manifest")).toBe(true);
    for (const entry of await run(manifest(root))) {
      expect(names.has(entry.id.replaceAll(".", "_"))).toBe(true);
    }

    const nodeAddTool = listed.tools.find((t) => t.name === "node_add");
    expect(nodeAddTool?.annotations?.destructiveHint).toBe(true);
    expect(nodeAddTool?.annotations?.readOnlyHint).toBe(false);
    expect(nodeAddTool?.annotations?.idempotentHint).toBe(false);
    expect(nodeAddTool?.annotations?.openWorldHint).toBe(false);

    const graphQueryTool = listed.tools.find((t) => t.name === "graph_query");
    expect(graphQueryTool?.annotations?.readOnlyHint).toBe(true);
    expect(graphQueryTool?.annotations?.destructiveHint).toBe(false);
    expect(graphQueryTool?.annotations?.idempotentHint).toBe(true);
    expect(graphQueryTool?._meta?.[ACTION_META_KEY]).toEqual({
      id: "graph.query",
      mode: { kind: "read" },
    });

    const add = await client.callTool({
      name: "node_add",
      arguments: { text: "hello-mcp" },
    });
    expect(add.isError).toBeFalsy();
    const addText = present(
      (add.content as { type: string; text: string }[])[0],
      "expected (add.content as { type: string; text: string }[])[0]",
    ).text;
    const added = JSON.parse(addText) as { id: string };
    expect(typeof added.id).toBe("string");

    const q = await client.callTool({
      name: "graph_query",
      arguments: {
        query: '[:find ?id :where [?e :node/id ?id] [?e :node/text "hello-mcp"]]',
      },
    });
    expect(q.isError).toBeFalsy();
    const qText = present(
      (q.content as { type: string; text: string }[])[0],
      "expected (q.content as { type: string; text: string }[])[0]",
    ).text;
    const queried = JSON.parse(qText) as { rows: unknown[][] };
    expect(queried.rows.some((r) => r[0] === added.id)).toBe(true);

    const man = await client.callTool({ name: "kb_manifest", arguments: {} });
    expect(man.isError).toBeFalsy();
    const manText = present(
      (man.content as { type: string; text: string }[])[0],
      "expected (man.content as { type: string; text: string }[])[0]",
    ).text;
    const manBody = JSON.parse(manText) as { actions: { id: string }[] };
    expect(manBody.actions.some((a) => a.id === "node.add")).toBe(true);
    expect(manBody.actions.some((a) => a.id === "kb.manifest")).toBe(true);

    await client.close();
    await server.close();
  });

  test("failed action returns isError with code+message, never throws", async () => {
    const server = await run(createMcpServer(root));
    const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "node_get",
      arguments: { id: "missing-node-id" },
    });
    expect(result.isError).toBe(true);
    const text = present(
      (result.content as { type: string; text: string }[])[0],
      "expected (result.content as { type: string; text: string }[])[0]",
    ).text;
    const body = JSON.parse(text) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message.length).toBeGreaterThan(0);

    await client.close();
    await server.close();
  });

  test("graph_query with malformed EDN returns isError invalid_input", async () => {
    const server = await run(createMcpServer(root));
    const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "graph_query",
      arguments: { query: "not [valid" },
    });
    expect(result.isError).toBe(true);
    const text = present(
      (result.content as { type: string; text: string }[])[0],
      "expected (result.content as { type: string; text: string }[])[0]",
    ).text;
    const body = JSON.parse(text) as { code: string };
    expect(body.code).toBe("invalid_input");

    await client.close();
    await server.close();
  });

  test("node_add under a sys.* parent returns isError forbidden", async () => {
    const server = await run(createMcpServer(root));
    const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "node_add",
      arguments: { text: "evil", parent: "sys.tag" },
    });
    expect(result.isError).toBe(true);
    const text = present(
      (result.content as { type: string; text: string }[])[0],
      "expected (result.content as { type: string; text: string }[])[0]",
    ).text;
    const body = JSON.parse(text) as { code: string };
    expect(body.code).toBe("forbidden");

    await client.close();
    await server.close();
  });

  test("views are ui:// resources and render_view returns html", async () => {
    await Effect.runPromise(
      addDocsView(root, "todos", {
        output: "docs/kb/todos.md",
        query:
          '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "todo"] [?n :node/id ?id]]',
        template: "todos",
      }),
    );

    const server = await run(createMcpServer(root));
    const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const resources = await client.listResources();
    const uris = resources.resources.map((r) => r.uri);
    expect(uris).toContain("ui://kb/view/todos");

    const read = await client.readResource({ uri: "ui://kb/view/todos" });
    const first = present(read.contents[0], "expected read.contents[0]");
    expect(first.mimeType).toBe("text/html");
    expect("text" in first && first.text).toContain("<h1>Todos</h1>");

    const rendered = await client.callTool({
      name: "render_view",
      arguments: { name: "todos", format: "md" },
    });
    const text = present(
      (rendered.content as Array<{ text: string }>)[0],
      "expected (rendered.content as Array<{ text: string }>)[0]",
    ).text;
    expect((JSON.parse(text) as { content: string }).content).toContain("# Todos");

    await client.close();
    await server.close();
  });
});
