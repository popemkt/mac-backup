import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Fiber } from "effect";
import {
  bunFileSystemLayer,
  kbRuntimeLayer,
  openKb,
  openKbEffect,
} from "../src/context.ts";
import { invokeReceiptEffect } from "../src/registry.ts";
import { runPlanEffect } from "../src/surface/cli.ts";
import { mapAdd, mapGet } from "../src/surface/map.ts";
import type { ManifestEntry } from "../src/registry.ts";
import {
  callToolEffect,
  createMcpServer,
  type McpToolContext,
} from "../src/surface/mcp.ts";
import { resolveRootEffect, RootNotFoundError } from "../src/surface/root.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-surface-effect-"));
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
      runPlanEffect(
        ctx,
        mapGet({ id: "n.does-not-exist" }),
        { json: true },
      ).pipe(Effect.provide(kbRuntimeLayer(ctx))),
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

  test("interrupted fiber yields Exit.interrupt", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        yield* Effect.sleep("10 seconds");
        return yield* runPlanEffect(
          ctx,
          mapAdd({ text: "never" }),
          { json: true },
        );
      }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
    );
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.hasInterrupts(exit)).toBe(true);
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
    const unknown = await Effect.runPromise(
      callToolEffect(ctx, "no_such_tool", {}, tools),
    );
    expect(unknown.isError).toBe(true);
    const unknownBody = JSON.parse(
      (unknown.content as { text: string }[])[0]!.text,
    ) as { code: string };
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
    const failedBody = JSON.parse(
      (failed.content as { text: string }[])[0]!.text,
    ) as { code: string };
    expect(failedBody.code).toBe("not_found");
  });

  test("callToolEffect Schema-decodes render_view args", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const tools: McpToolContext = { actions: [], byToolName: new Map() };
    const bad = await Effect.runPromise(
      callToolEffect(ctx, "render_view", { view: 1 }, tools),
    );
    expect(bad.isError).toBe(true);
    const body = JSON.parse(
      (bad.content as { text: string }[])[0]!.text,
    ) as { message: string };
    expect(body.message).toContain("expected {view: string");
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
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const q = await client.callTool({
      name: "graph_query",
      arguments: {
        query:
          '[:find ?id :where [?e :node/id ?id] [?e :node/text "from-cli-effect"]]',
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
