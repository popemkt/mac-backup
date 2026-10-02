/**
 * The surface contract (`@kb/test-kit`'s `surfaceContract`) run over every
 * surface that projects the action registry. This package is the one place
 * that can reach all five: the CLI is its own, and it composes the MCP and
 * HTTP servers, the page's WebMCP adapter, and the agent bridge the `kb ui`
 * server hosts.
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
  AGENT_CHANNEL,
  AGENT_WIRE,
  AgentEventSchema,
  agentPlugin,
  scriptedRuntime,
  type AgentEvent,
  type ScriptStep,
} from "@kb/agent";
import {
  FakeModelContext,
  FakeTab,
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

/**
 * What the agent surface asks its scripted model to do: list the tools it
 * was given, or call one. The model answers in text, so the harness reads
 * the agent's own view of the listing and of the receipt.
 */
const ContractAskSchema = z.union([
  z.object({ list: z.literal(true) }),
  z.object({ call: z.object({ id: z.string(), input: z.unknown() }) }),
]);

const contractRuntime = scriptedRuntime((turn): readonly ScriptStep[] => {
  const ask = ContractAskSchema.parse(JSON.parse(turn.message.text));
  if ("list" in ask) {
    return [{ say: JSON.stringify(turn.tools.map(({ id, mode }) => ({ id, mode }))) }];
  }
  const { id, input } = ask.call;
  return [{ call: id, input, answer: (receipt) => JSON.stringify(receipt) }];
});

/** The root's one `kb ui`, on an ephemeral port, hosting the agent over the scripted model. */
const serve: ServeUi = async (root) => {
  const handle = await Effect.runPromise(
    startUi({
      root,
      port: 0,
      openBrowser: false,
      plugins: [agentPlugin({ runtime: contractRuntime })],
    }).pipe(Effect.provide(bunFileSystemLayer)),
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

/** The agent channel's events of one conversation, from what `tab` has heard so far. */
function agentEvents(tab: FakeTab, from: number, conversation: string): AgentEvent[] {
  return tab
    .heard(AGENT_CHANNEL)
    .slice(from)
    .flatMap((frame) => (frame.kind === "data" ? [AgentEventSchema.parse(frame.data)] : []))
    .filter((event) => event.conversation === conversation);
}

/**
 * The agent: a sidebar tab on the root's `kb ui` sends a message on the
 * agent channel, and the scripted model lists its tools or makes the call.
 * A call the mode says needs approval reaches the person, who makes it
 * through the browser's lane (`POST /api/action`) with approval exactly as
 * the invocation declares it, and answers the receipt. The receipt is the
 * one the model was given.
 */
const agent: SurfaceFactory = async (_root, ui) => {
  // A connection that publishes no screen, so the root's one tab stays the contract's own.
  const tab = await Effect.runPromise(FakeTab.open(ui.url, "sidebar.surface-contract", null));
  let turns = 0;
  const say = async (ask: unknown, approved: boolean): Promise<string> => {
    turns += 1;
    const conversation = `contract-${turns}`;
    const from = tab.heard(AGENT_CHANNEL).length;
    tab.say(AGENT_CHANNEL, { type: "send", conversation, text: JSON.stringify(ask) });
    const answered = new Set<string>();
    const deadline = Date.now() + 10_000;
    for (;;) {
      const events = agentEvents(tab, from, conversation);
      for (const event of events) {
        if (event.type !== "tool-call" || !event.approval || answered.has(event.call)) continue;
        answered.add(event.call);
        const invocation = { id: event.action, input: event.input, approved };
        const receipt = await postAction(ui.url, invocation);
        tab.say(AGENT_CHANNEL, { type: "receipt", conversation, call: event.call, receipt });
      }
      const end = events.find((event) => event.type === "turn-end");
      if (end !== undefined) {
        if (end.outcome !== "done") throw new Error(`agent turn ${end.outcome}`);
        return events.flatMap((event) => (event.type === "text" ? [event.delta] : [])).join("");
      }
      if (Date.now() > deadline)
        throw new Error(`agent turn never ended: ${JSON.stringify(events)}`);
      await Bun.sleep(5);
    }
  };
  return {
    wire: AGENT_WIRE,
    list: async () =>
      z.array(ListedActionSchema).parse(JSON.parse(await say({ list: true }, false))),
    invoke: async ({ id, input, approved }) =>
      ActionReceiptSchema.parse(JSON.parse(await say({ call: { id, input } }, approved === true))),
    close: () => Effect.runPromise(tab.close),
  } satisfies ActionSurface;
};

surfaceContract({ serve, surfaces: { cli, mcp, http, webmcp, agent } });
