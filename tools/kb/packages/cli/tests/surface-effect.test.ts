import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  kbRuntimeLayer,
  openKb,
  openKbEffect,
  invokeReceiptEffect,
  resetRegistryCache,
  resolveRootEffect,
  RootNotFoundError,
} from "@kb/runtime";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { runPlanEffect } from "../src/cli.ts";
import { mapAdd, mapGet } from "@kb/operations";
import type { ManifestEntry } from "@kb/runtime";
import {
  callToolEffect,
  containToolResult,
  createMcpServer,
  mcpInternalError,
  runResourceHandler,
  type McpToolContext,
} from "@kb/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-surface-effect-"));
}

/** Under tests/ so fixture extensions resolve zod via tools/kb/node_modules. */
async function tempExtRoot(): Promise<string> {
  return mkdtemp(join(import.meta.dir, "kb-surface-effect-"));
}

describe("CLI Effect surface", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("runPlanEffect succeeds and fails with stable exit codes", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const ok = await Effect.runPromise(
      runPlanEffect(ctx, mapAdd({ text: "surface-ok" }), { json: true }).pipe(
        Effect.provide(kbRuntimeLayer(ctx)),
      ),
    );
    expect(ok).toBe(0);

    const failed = await Effect.runPromise(
      runPlanEffect(ctx, mapGet({ id: "n.does-not-exist" }), { json: true }).pipe(
        Effect.provide(kbRuntimeLayer(ctx)),
      ),
    );
    expect(failed).toBe(1);
  });

  test("resolveRootEffect fails with RootNotFoundError", async () => {
    root = await tempRoot();
    const caught = await Effect.runPromise(
      resolveRootEffect({ cwd: root }).pipe(
        Effect.provide(bunFileSystemLayer),
        Effect.catch((e) => Effect.succeed(e)),
      ),
    );
    expect(caught).toBeInstanceOf(RootNotFoundError);
  });

  test("Effect runtime: Fiber.interrupt prevents completion (not surface wiring)", async () => {
    // Lifecycle guarantee of the Effect runtime only — does not exercise
    // Commander/MCP surfaces or claim abort signals reach running actions.
    let completed = false;
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        yield* Effect.sleep("5 seconds");
        completed = true;
        return 0;
      }),
    );
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(completed).toBe(false);
  });
});

describe("MCP Effect surface", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("callToolEffect maps unknown tool and failed actions to isError", async () => {
    root = await tempRoot();
    const ctx = await Effect.runPromise(
      openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const tools: McpToolContext = {
      actions: [],
      byToolName: new Map(),
    };
    const unknown = await Effect.runPromise(callToolEffect(ctx, "no_such_tool", {}, tools));
    expect(unknown.isError).toBe(true);
    const unknownBody = JSON.parse((unknown.content as { text: string }[])[0]!.text) as {
      code: string;
    };
    expect(unknownBody.code).toBe("unknown_action");

    // Register node.get via a real server tool map entry shape.
    const live = await createMcpServer(root);
    await live.close();
    const viaReceipt = await Effect.runPromise(
      invokeReceiptEffect(ctx, {
        id: "node.get",
        input: { id: "missing" },
      }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
    );
    expect(viaReceipt.status).toBe("failed");

    const nodeGetEntry: ManifestEntry = {
      id: "node.get",
      title: "Get",
      description: "get",
      mode: "read",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    };
    const toolsWithGet: McpToolContext = {
      actions: [],
      byToolName: new Map([["node_get", nodeGetEntry]]),
    };
    const failed = await Effect.runPromise(
      callToolEffect(ctx, "node_get", { id: "missing" }, toolsWithGet),
    );
    expect(failed.isError).toBe(true);
    const failedBody = JSON.parse((failed.content as { text: string }[])[0]!.text) as {
      code: string;
    };
    expect(failedBody.code).toBe("not_found");
  });

  test("callToolEffect Schema-decodes render_view args", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const tools: McpToolContext = { actions: [], byToolName: new Map() };
    const bad = await Effect.runPromise(callToolEffect(ctx, "render_view", { view: 1 }, tools));
    expect(bad.isError).toBe(true);
    const body = JSON.parse((bad.content as { text: string }[])[0]!.text) as { message: string };
    expect(body.message).toContain("expected {view: string");
  });

  test("render_view format:null defaults to html like base MCP clients", async () => {
    root = await tempRoot();
    await mkdir(join(root, ".kb", "views"), { recursive: true });
    await writeFile(
      join(root, ".kb", "views", "todos.json"),
      JSON.stringify({
        output: "docs/kb/todos.md",
        query:
          '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "todo"] [?n :node/id ?id]]',
        template: "todos",
      }),
    );
    const ctx = await openKb(root);
    const tools: McpToolContext = { actions: [], byToolName: new Map() };
    const rendered = await Effect.runPromise(
      callToolEffect(ctx, "render_view", { view: "todos", format: null }, tools),
    );
    expect(rendered.isError).toBeFalsy();
    const text = (rendered.content as { text: string }[])[0]!.text;
    expect(text).toContain("<h1>Todos</h1>");
    expect(text).not.toMatch(/^# Todos/m);
  });

  test("containToolResult maps Die defects to isError internal (never rejects)", async () => {
    const result = await Effect.runPromise(
      containToolResult(Effect.die(new Error("injected-defect"))),
    );
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      code: string;
      message: string;
    };
    expect(body.code).toBe("internal");
    expect(body.message).toContain("injected-defect");
  });

  test("mcpInternalError maps defects to JSON-RPC -32603", () => {
    const err = mcpInternalError(Cause.die(new Error("resource-defect")));
    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(ErrorCode.InternalError);
    expect(err.code).toBe(-32603);
    expect(err.message).toContain("resource-defect");
  });

  test("runResourceHandler Die defect canonicalizes to numeric -32603", async () => {
    try {
      await runResourceHandler(Effect.die(new Error("injected-resource-die")));
      expect.unreachable("expected McpError");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      expect(typeof (err as McpError).code).toBe("number");
      expect((err as McpError).code).toBe(-32603);
      expect((err as McpError).code).toBe(ErrorCode.InternalError);
      expect((err as McpError).message).toContain("injected-resource-die");
    }
  });

  test("resource Fail surfaces as McpError -32603 to the client", async () => {
    root = await tempRoot();
    const server = await createMcpServer(root);
    const client = new Client({ name: "surface-effect", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      await client.readResource({ uri: "ui://kb/view/missing-view" });
      expect.unreachable("expected McpError");
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      expect(typeof (err as McpError).code).toBe("number");
      expect((err as McpError).code).toBe(-32603);
    }

    await client.close();
    await server.close();
  });

  test("CallTool e2e: registered rejecting handler becomes isError", async () => {
    root = await tempExtRoot();
    await mkdir(join(root, ".kb", "extensions"), { recursive: true });
    await writeFile(
      join(root, ".kb", "extensions", "boom.ts"),
      `import { z } from "zod";
export default [{
  id: "reject",
  title: "Reject",
  description: "test rejecting handler",
  mode: "read",
  inputSchema: z.object({}),
  outputSchema: z.unknown(),
  handler: async () => { throw new Error("injected-handler-reject"); },
}];
`,
    );
    resetRegistryCache();
    const server = await createMcpServer(root);
    const client = new Client({ name: "surface-effect", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "ext_boom_reject",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      code: string;
      message: string;
    };
    expect(body.message).toContain("injected-handler-reject");

    await client.close();
    await server.close();
    resetRegistryCache();
  });

  test("render_view advertised inputSchema accepts null format", async () => {
    root = await tempRoot();
    const server = await createMcpServer(root);
    const client = new Client({ name: "surface-effect", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const listed = await client.listTools();
    const renders = listed.tools.filter((t) => t.name === "render_view");
    expect(renders).toHaveLength(1);
    const format = (
      renders[0]!.inputSchema as {
        properties?: {
          format?: { anyOf?: unknown[]; default?: unknown };
        };
        required?: string[];
      }
    ).properties?.format;
    expect(renders[0]!.inputSchema).toMatchObject({
      required: ["view"],
    });
    expect(format?.default).toBe("html");
    expect(JSON.stringify(format)).toContain('"null"');

    await client.close();
    await server.close();
  });

  test("lifecycle: MCP reload sees CLI Effect write", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    await Effect.runPromise(
      runPlanEffect(ctx, mapAdd({ text: "from-cli-effect", id: "n.cli" }), {
        json: true,
      }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
    );

    const server = await createMcpServer(root);
    const client = new Client({ name: "surface-effect", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const q = await client.callTool({
      name: "graph_query",
      arguments: {
        query: '[:find ?id :where [?e :node/id ?id] [?e :node/text "from-cli-effect"]]',
      },
    });
    expect(q.isError).toBeFalsy();
    const text = (q.content as { type: string; text: string }[])[0]!.text;
    const body = JSON.parse(text) as { rows: unknown[][] };
    expect(body.rows.some((r) => r[0] === "n.cli")).toBe(true);

    await client.close();
    await server.close();
  });
});
