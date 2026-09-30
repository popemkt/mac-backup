/**
 * The surface contract (`@kb/test-kit`'s `surfaceContract`) run over every
 * surface that projects the action registry. This package is the one place
 * that can reach all four: the CLI is its own, and it composes the MCP and
 * HTTP servers and the page's WebMCP adapter.
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
import { ACTION_META_KEY, MCP_WIRE, createMcpServer } from "@kb/mcp";
import { bunFileSystemLayer } from "@kb/runtime";
import { HTTP_WIRE, startUi } from "@kb/server";
import {
  FakeModelContext,
  surfaceContract,
  type ActionSurface,
  type ListedAction,
  type ServeUi,
  type SurfaceFactory,
} from "@kb/test-kit";
import { ToolCallFailed, WEBMCP_WIRE, startWebMcp, type ModelContextTool } from "@kb/webmcp";
import { z } from "zod";
import { ACTION_INVOKE_WIRE, main } from "../src/cli.ts";

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
    wire: ACTION_INVOKE_WIRE,
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
    wire: MCP_WIRE,
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

/** The root's one `kb ui`, on an ephemeral port. */
const serve: ServeUi = async (root) => {
  const handle = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false }).pipe(Effect.provide(bunFileSystemLayer)),
  );
  return { url: handle.url, stop: () => Effect.runPromise(handle.stop) };
};

/** `POST /api/action`, and the receipt from its response. */
async function postAction(url: string, invocation: ActionInvocation): Promise<ActionReceipt> {
  const res = await fetch(`${url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invocation),
  });
  const response = ActionResponseSchema.parse(await res.json());
  if (response.status === "failed") return response;
  const { rev: _rev, ...receipt } = response;
  return receipt;
}

/** HTTP: `GET /api/manifest` is the listing; `POST /api/action` carries the envelope. */
const http: SurfaceFactory = async (_root, ui) => ({
  wire: HTTP_WIRE,
  list: async () =>
    z.array(ListedActionSchema).parse(await (await fetch(`${ui.url}/api/manifest`)).json()),
  invoke: (invocation) => postAction(ui.url, invocation),
  close: async () => undefined,
});

/** A tool's mode, read back from the hints alone, as a WebMCP agent sees it. */
function modeOf(tool: ModelContextTool): ListedAction["mode"] {
  const { readOnlyHint, consequentialHint } = tool.annotations ?? {};
  if (readOnlyHint === true && consequentialHint !== true) return { kind: "read" };
  if (consequentialHint === true && readOnlyHint !== true) return { kind: "write" };
  throw new Error(`${tool.name}: hints name no mode`);
}

/**
 * WebMCP: the tools registered on a spec-shaped `document.modelContext` are
 * the listing, and a call is `execute` on the tool of that name. The adapter
 * runs over the browser's server lane (`POST /api/action`, as the UI's
 * `postAction` sends it). A call to an action it registered no tool for
 * cannot be made at all.
 */
const webmcp: SurfaceFactory = async (_root, ui) => {
  const page = new FakeModelContext();
  const adapter = startWebMcp({
    modelContext: () => page,
    invoke: (invocation) => postAction(ui.url, invocation),
    report: (message) => {
      throw new Error(message);
    },
  });
  await adapter.settled();
  return {
    wire: WEBMCP_WIRE,
    list: async () => page.tools().map((tool) => ({ id: tool.name, mode: modeOf(tool) })),
    invoke: async ({ id, input }) => {
      const tool = page.tool(id);
      if (tool === undefined) return null;
      // WebMCP reports a receipt that did not succeed as the tool's error.
      try {
        return ActionReceiptSchema.parse(await tool.execute(input));
      } catch (error) {
        if (error instanceof ToolCallFailed) return ActionReceiptSchema.parse(error.receipt);
        throw error;
      }
    },
    close: async () => {
      adapter.stop();
    },
  } satisfies ActionSurface;
};

surfaceContract({ serve, surfaces: { cli, mcp, http, webmcp } });
