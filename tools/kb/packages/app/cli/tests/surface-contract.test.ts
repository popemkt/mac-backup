/**
 * The surface contract (`@kb/test-kit`'s `surfaceContract`) run over every
 * surface that projects the action registry. This package is the one place
 * that can reach all three: the CLI is its own, and it composes the MCP and
 * HTTP servers.
 *
 * Each adapter speaks its surface's own protocol and turns the answer back
 * into a listing and a receipt without consulting the registry. That way a
 * surface that drops, renames or re-shapes something fails the contract.
 */
import { Effect } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ActionReceiptSchema,
  ActionResponseSchema,
  ManifestEntrySchema,
  type ActionInvocation,
  type ActionReceipt,
} from "@kb/contracts";
import { ACTION_META_KEY, createMcpServer } from "@kb/mcp";
import { bunFileSystemLayer } from "@kb/runtime";
import { startUi } from "@kb/server";
import {
  surfaceContract,
  type ActionSurface,
  type ListedAction,
  type SurfaceFactory,
} from "@kb/test-kit";
import { z } from "zod";
import { main } from "../src/cli.ts";

/** What a listing must say of each action; the mode is decoded by the contracts' own schema. */
const ListedActionSchema = ManifestEntrySchema.pick({ id: true, mode: true });
const ManifestOutputSchema = z.object({ actions: z.array(ListedActionSchema) });

function manifestOf(receipt: ActionReceipt): ListedAction[] {
  if (receipt.status !== "succeeded") throw new Error(`kb.manifest failed: ${receipt.message}`);
  return ManifestOutputSchema.parse(receipt.output).actions;
}

/** Run `kb` in-process and capture stdout; `--json` makes it a receipt. */
async function kb(root: string, args: string[]): Promise<string> {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  try {
    await main(["bun", "kb", "--root", root, "--json", ...args]);
    return chunks.join("");
  } finally {
    process.stdout.write = write;
    process.exitCode = 0;
  }
}

/** `kb action-invoke`: the envelope is the JSON argument, so it carries approval. */
const cli: SurfaceFactory = async (root) => {
  const invokeCli = async (invocation: ActionInvocation) =>
    ActionReceiptSchema.parse(
      JSON.parse(await kb(root, ["action-invoke", JSON.stringify(invocation)])),
    );
  return {
    carriesApproval: true,
    list: async () => manifestOf(await invokeCli({ id: "kb.manifest", input: {} })),
    invoke: invokeCli,
    close: async () => undefined,
  } satisfies ActionSurface;
};

const McpToolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
});
const McpFailureSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

/**
 * MCP: the tool list is the listing, read from each tool's `_meta`. A call
 * is `tools/call` on that tool with the input as its arguments. There is no
 * envelope, so `approved` has nowhere to go and is dropped.
 */
const mcp: SurfaceFactory = async (root) => {
  const server = await Effect.runPromise(
    createMcpServer(root).pipe(Effect.provide(bunFileSystemLayer)),
  );
  const client = new Client({ name: "kb-surface-contract", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const listed = (await client.listTools()).tools.map((tool) => ({
    tool: tool.name,
    action: ListedActionSchema.parse(tool._meta?.[ACTION_META_KEY]),
  }));

  return {
    carriesApproval: false,
    list: async () => listed.map(({ action }) => action),
    invoke: async ({ id, input }) => {
      // An action MCP leaves out of tools/list is still called by its tool
      // name: the id with `.` mangled to `_`, as a caller would guess it.
      const tool = listed.find(({ action }) => action.id === id)?.tool ?? id.replaceAll(".", "_");
      const result = McpToolResultSchema.parse(
        await client.callTool({ name: tool, arguments: input as Record<string, unknown> }),
      );
      const body: unknown = JSON.parse(result.content[0]?.text ?? "null");
      if (result.isError !== true) return { status: "succeeded", id, output: body };
      return ActionReceiptSchema.parse({ status: "failed", id, ...McpFailureSchema.parse(body) });
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  } satisfies ActionSurface;
};

/** HTTP: `GET /api/manifest` is the listing; `POST /api/action` carries the envelope. */
const http: SurfaceFactory = async (root) => {
  const handle = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false }).pipe(Effect.provide(bunFileSystemLayer)),
  );
  return {
    carriesApproval: true,
    list: async () =>
      z.array(ListedActionSchema).parse(await (await fetch(`${handle.url}/api/manifest`)).json()),
    invoke: async (invocation) => {
      const res = await fetch(`${handle.url}/api/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invocation),
      });
      const response = ActionResponseSchema.parse(await res.json());
      if (response.status === "failed") return response;
      const { rev: _rev, ...receipt } = response;
      return receipt;
    },
    close: () => Effect.runPromise(handle.stop),
  } satisfies ActionSurface;
};

surfaceContract({ cli, mcp, http });
