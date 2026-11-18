// bb-plugin-kb — the backend. Keeps the named kb stores (lib/stores.ts), tells the thread panel which pages it
// can frame, keeps the kb tab (session and store) each thread's panel reports, and gives the thread's agent
// tools that call a store, in that tab when the tab shows it: a call made there acts in the tab the person sees
// beside the thread (kb DESIGN.md → Action registry → A call made in a tab session), and a call with no panel
// open, or to another store, is made in no session.
import { request } from "node:http";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { manifestAnswer, receiptAnswer, ThreadSessions, type ToolAnswer } from "./lib/kb";
import { viaOfThread } from "./lib/links";
import {
  chooseStore,
  legacyLine,
  parseConnections,
  resolveStores,
  storesLine,
  type KbAddress,
  type KbConnection,
  type KbStores,
} from "./lib/stores";
import { registerLinks, type KbAccess } from "./links";

/** A store as the panel needs it: its name and the page it frames (null: tools only). */
const StoreView = z.object({ name: z.string(), page: z.string().nullable() });

export const rpcContract = defineRpcContract({
  /** The stores the panel can show, the one it shows unless told otherwise, and whether a thread opens it by itself. */
  config: {
    input: z.object({}),
    output: z.object({ stores: z.array(StoreView), defaultStore: z.string().nullable(), autoOpen: z.boolean() }),
  },
  /** The kb tab the thread's panel shows now (its session, of which store), or (null) that it no longer shows kb. */
  reportSession: {
    input: z.object({
      threadId: z.string().min(1),
      tab: z.object({ session: z.string().min(1), store: z.string().min(1) }).nullable(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
});

/** How long one call to kb may take before the tool answers that it did not. */
const KB_TIMEOUT_MS = 30_000;

interface KbResponse {
  readonly status: number;
  readonly body: unknown;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * One request to kb's HTTP API as a local program (no `Origin`: kb's program wire). Over the socket it names
 * `localhost`, as kb's proxy does.
 */
function callKb(at: KbAddress, method: "GET" | "POST", path: string, body?: unknown): Promise<KbResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = payload === undefined ? {} : { "content-type": "application/json" };
  if ("url" in at) {
    return fetch(new URL(path, at.url), {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(KB_TIMEOUT_MS),
    }).then(async res => ({ status: res.status, body: parseBody(await res.text()) }));
  }
  return new Promise((resolve, reject) => {
    const req = request(
      { socketPath: at.socket, path, method, headers: { host: "localhost", ...headers }, timeout: KB_TIMEOUT_MS },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: parseBody(Buffer.concat(chunks).toString("utf8")) }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`kb did not answer within ${KB_TIMEOUT_MS / 1000}s`)));
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const INSTRUCTIONS = [
  "kb is the person's knowledge base (a graph of nodes, fields and tags, with outline, graph and canvas views).",
  "Several kb stores may be configured, each by name; kb_manifest's first line lists them. Every tool takes an",
  "optional kb (a store name): omitted, a call goes to the store the open panel shows, else the default store.",
  "kb may be open in this thread's side panel; while it is, kb_call makes each call to that store in that tab, so",
  "you act on what the person sees: an input kb_manifest marks as filled 'in the tab' (node.update's id is the",
  "node they focus, a canvas verb's canvasId is the canvas they have open) may be left out, and the answer says",
  "what it was. ui.navigate and ui.select move that tab to show the person your work. With no panel open, or for",
  "another store, calls are made in no tab: pass every input. Start with kb_manifest to see the stores and",
  "actions, and kb_screen to see what the tab shows.",
].join(" ");

/** The tools' optional store parameter. */
const KB_PARAM = z
  .string()
  .min(1)
  .optional()
  .describe("The kb store to call, by name (kb_manifest lists them); omitted: the store the kb tab shows, else the default");

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    connections: {
      type: "string",
      label: "kb stores",
      description:
        "One store per line: `<name> <page URL> [<socket path> | <API URL>]`, or `<name> <socket path>` for tools only. Adds to the stores bb's KB_CONNECTIONS declares, replacing one of the same name.",
      experimental_multiline: true,
      experimental_schema: {
        "~standard": {
          version: 1,
          vendor: "bb-plugin-kb",
          validate: (value: unknown) => {
            const problems = typeof value === "string" ? parseConnections(value).problems : ["not text"];
            return problems.length === 0
              ? { value: value as string }
              : { issues: problems.map(message => ({ message })) };
          },
        },
      },
      default: "",
    },
    defaultKb: {
      type: "string",
      label: "Default store",
      description: "The store a tool call and a new panel use unless told otherwise. Empty: KB_DEFAULT, else the first store.",
      default: "",
    },
    url: {
      type: "string",
      label: "kb page URL (legacy)",
      description: "Replaced by kb stores: a value here moves there, as the store `default`, when the plugin loads.",
      default: "",
    },
    socket: {
      type: "string",
      label: "kb socket (legacy)",
      description: "Replaced by kb stores: a value here moves there, with the page URL, when the plugin loads.",
      default: "",
    },
    autoOpen: {
      type: "boolean",
      label: "Open with each thread",
      description: "Open the kb panel beside a thread when it is shown (once per thread in each window).",
      default: true,
    },
  });

  // The single-store settings of earlier releases become one store, named `default`, so nothing configured breaks.
  {
    const { url, socket, connections } = await settings.get();
    const line = legacyLine(url, socket, process.env);
    if (line !== null) {
      const known = parseConnections(connections).connections.some(c => c.name === line.split(" ")[0]);
      try {
        await settings.experimental_set({
          ...(known ? {} : { connections: connections.trim() === "" ? line : `${connections.trimEnd()}\n${line}` }),
          url: null,
          socket: null,
        });
        bb.log.info(`moved the legacy url/socket settings into kb stores${known ? " (a store of that name was there already)" : ""}`);
      } catch (err) {
        bb.log.warn(`could not move the legacy url/socket settings: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const sessions = new ThreadSessions();

  async function stores(): Promise<KbStores> {
    const { connections, defaultKb } = await settings.get();
    const resolved = resolveStores({ connections, defaultKb, env: process.env });
    for (const problem of resolved.problems) bb.log.warn(problem);
    return resolved;
  }

  /** The store a thread's call goes to, by its name, the thread's tab, or the default. */
  async function storeFor(threadId: string | undefined, named: string | undefined) {
    const shown = threadId === undefined ? undefined : sessions.live(threadId, Date.now())?.store;
    return chooseStore(await stores(), named, shown);
  }

  /** Run one kb request for a tool, its failure an error answer rather than a thrown tool. */
  async function ask(
    threadId: string,
    named: string | undefined,
    read: (store: KbConnection, session: string | undefined) => Promise<ToolAnswer>,
  ): Promise<ToolAnswer> {
    const chosen = await storeFor(threadId, named);
    if ("error" in chosen) return { text: chosen.error, isError: true };
    const { connection } = chosen;
    try {
      return await read(connection, sessions.sessionIn(threadId, connection.name, Date.now()));
    } catch (err) {
      return {
        text: `kb store ${connection.name} could not be reached: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  const asContent = ({ text, isError }: ToolAnswer) => ({ content: [{ type: "text" as const, text }], isError });

  /** One store's API, by name, read from the configuration at each call. */
  async function addressOf(name: string): Promise<KbAddress | null> {
    return (await stores()).connections.find(c => c.name === name)?.api ?? null;
  }

  // Linked items (links.ts): what the thread's agent wrote in each store, read back from that store's log.
  const access = (name: string): KbAccess => ({
    async call(id, input, options = {}) {
      const at = await addressOf(name);
      if (at === null) return { ok: false, message: `kb has no store named ${name}` };
      const res = await callKb(at, "POST", "/api/action", { id, input, ...options });
      const body = res.body as { status?: unknown; output?: unknown; message?: unknown };
      return body?.status === "succeeded"
        ? { ok: true, output: body.output }
        : { ok: false, message: typeof body?.message === "string" ? body.message : `kb answered HTTP ${res.status}` };
    },
    async root() {
      const at = await addressOf(name);
      if (at === null) return null;
      const body = (await callKb(at, "GET", "/api/identity")).body as { root?: unknown };
      return typeof body?.root === "string" ? body.root : null;
    },
    session: threadId => sessions.sessionIn(threadId, name, Date.now()),
  });
  const links = registerLinks(bb, {
    names: async () => (await stores()).connections.map(c => c.name),
    storeOf: async (threadId, named) => {
      const chosen = await storeFor(threadId, named);
      return "error" in chosen ? null : chosen.connection.name;
    },
    access,
  });

  bb.rpc.register(rpcContract, {
    config: async () => {
      const { connections, defaultName } = await stores();
      return {
        stores: connections.map(({ name, page }) => ({ name, page })),
        defaultStore: defaultName,
        autoOpen: (await settings.get()).autoOpen,
      };
    },
    reportSession: async ({ threadId, tab }) => {
      sessions.report(threadId, tab, Date.now());
      links.onSession(threadId, tab);
      return { ok: true as const };
    },
  });

  bb.agents.registerTool({
    name: "kb_call",
    description:
      "Invoke one kb action by id with its input, in a kb store (kb: its name; omitted, the store the kb tab shows, else the default). Made in the kb tab beside this thread when it shows that store, so inputs kb_manifest marks as filled in the tab may be left out.",
    instructions: INSTRUCTIONS,
    presentation: { label: { pending: "Calling kb", completed: "Called kb" } },
    parameters: z.object({
      id: z.string().min(1).describe("The action id, as kb_manifest lists it (node.update, ui.navigate, …)"),
      input: z.record(z.string(), z.unknown()).optional().describe("The action's input; {} when absent"),
      kb: KB_PARAM,
    }),
    async execute({ id, input, kb }, { threadId }) {
      const answer = await ask(threadId, kb, async (store, session) => {
        const res = await callKb(store.api, "POST", "/api/action", {
          id,
          input: input ?? {},
          ...(session === undefined ? {} : { session }),
          via: viaOfThread(threadId),
        });
        return receiptAnswer(res.body, res.status);
      });
      return asContent(answer);
    },
  });

  bb.agents.registerTool({
    name: "kb_screen",
    description:
      "What the person's kb tab beside this thread shows: its route, panes, focus, selection and canvas camera. Every open kb tab of the store when the panel is closed or shows another store.",
    presentation: { label: { pending: "Looking at kb", completed: "Looked at kb" } },
    parameters: z.object({ kb: KB_PARAM }),
    async execute({ kb }, { threadId }) {
      const answer = await ask(threadId, kb, async (store, session) => {
        const res = await callKb(store.api, "POST", "/api/action", {
          id: "ui.screen",
          input: session === undefined ? {} : { session },
        });
        return receiptAnswer(res.body, res.status);
      });
      return asContent(answer);
    },
  });

  bb.agents.registerTool({
    name: "kb_manifest",
    description:
      "The configured kb stores (first line), then kb's actions: one line each (id, read or write, title, what the tab fills), or with id, that action whole with its input schema.",
    presentation: { label: { pending: "Listing kb actions", completed: "Listed kb actions" } },
    parameters: z.object({ id: z.string().min(1).optional().describe("One action to show whole"), kb: KB_PARAM }),
    async execute({ id, kb }, { threadId }) {
      const all = await stores();
      const shown = sessions.live(threadId, Date.now())?.store;
      const answer = await ask(threadId, kb, async store => {
        const res = await callKb(store.api, "GET", "/api/manifest");
        const listing = manifestAnswer(res.body, id);
        return id !== undefined || listing.isError
          ? listing
          : { text: `${storesLine(all, shown)}\nactions of ${store.name}:\n${listing.text}`, isError: false };
      });
      return answer.isError && id === undefined && all.connections.length > 0
        ? asContent({ text: `${storesLine(all, shown)}\n${answer.text}`, isError: true })
        : asContent(answer);
    },
  });
}
