// bb-plugin-kb — the backend. Tells the thread panel which kb page to frame, keeps the kb tab session each
// thread's panel reports, and gives the thread's agent tools that call kb in that session: a call made there
// acts in the tab the person sees beside the thread (kb DESIGN.md → Action registry → A call made in a tab
// session), and with no panel open the same tools make calls in no session.
import { request } from "node:http";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { manifestAnswer, originOf, receiptAnswer, ThreadSessions, type ToolAnswer } from "./lib/kb";

export const rpcContract = defineRpcContract({
  /** What the panel frames, and whether a thread opens it by itself. */
  config: {
    input: z.object({}),
    output: z.object({ url: z.string().nullable(), autoOpen: z.boolean() }),
  },
  /** The kb tab session the thread's panel shows now, or (null) that it no longer shows kb. */
  reportSession: {
    input: z.object({ threadId: z.string().min(1), session: z.string().min(1).nullable() }),
    output: z.object({ ok: z.literal(true) }),
  },
});

/** How long one call to kb may take before the tool answers that it did not. */
const KB_TIMEOUT_MS = 30_000;

interface KbResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Where kb is reached from this server: its owner-only socket, or its page's URL. */
type KbAddress = { readonly socket: string } | { readonly url: string };

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
  "It may be open in this thread's side panel; while it is, kb_call makes each call in that tab, so you act on",
  "what the person sees: an input kb_manifest marks as filled 'in the tab' (node.update's id is the node they",
  "focus, a canvas verb's canvasId is the canvas they have open) may be left out, and the answer says what it",
  "was. ui.navigate and ui.select move that tab to show the person your work. With no panel open, calls are made",
  "in no tab: pass every input. Start with kb_manifest to see the actions, and kb_screen to see what the tab shows.",
].join(" ");

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    url: {
      type: "string",
      label: "kb page URL",
      description: "The kb page the panel shows. Empty: the server's KB_URL.",
      default: "",
    },
    socket: {
      type: "string",
      label: "kb socket",
      description:
        "kb ui's Unix socket on this server, which agent tools call kb through. Empty: the server's KB_SOCKET, else the page URL.",
      default: "",
    },
    autoOpen: {
      type: "boolean",
      label: "Open with each thread",
      description: "Open the kb panel beside a thread when it is shown (once per thread in each window).",
      default: false,
    },
  });

  const sessions = new ThreadSessions();

  async function pageUrl(): Promise<string | null> {
    const { url } = await settings.get();
    const chosen = url.trim() === "" ? (process.env.KB_URL ?? "") : url.trim();
    return originOf(chosen) === null ? null : chosen;
  }

  async function address(): Promise<KbAddress | null> {
    const { socket } = await settings.get();
    const chosen = socket.trim() === "" ? (process.env.KB_SOCKET ?? "") : socket.trim();
    if (chosen !== "") return { socket: chosen };
    const url = await pageUrl();
    return url === null ? null : { url };
  }

  /** Run one kb request for a tool, its failure an error answer rather than a thrown tool. */
  async function ask(read: (at: KbAddress) => Promise<ToolAnswer>): Promise<ToolAnswer> {
    const at = await address();
    if (at === null) {
      return { text: "kb is not configured: set the kb plugin's page URL or socket (bb plugin config kb).", isError: true };
    }
    try {
      return await read(at);
    } catch (err) {
      return { text: `kb could not be reached: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }

  const asContent = ({ text, isError }: ToolAnswer) => ({ content: [{ type: "text" as const, text }], isError });

  bb.rpc.register(rpcContract, {
    config: async () => ({ url: await pageUrl(), autoOpen: (await settings.get()).autoOpen }),
    reportSession: async ({ threadId, session }) => {
      sessions.report(threadId, session, Date.now());
      return { ok: true as const };
    },
  });

  bb.agents.registerTool({
    name: "kb_call",
    description:
      "Invoke one kb action by id with its input. Made in the kb tab beside this thread when one is open, so inputs kb_manifest marks as filled in the tab may be left out.",
    instructions: INSTRUCTIONS,
    presentation: { label: { pending: "Calling kb", completed: "Called kb" } },
    parameters: z.object({
      id: z.string().min(1).describe("The action id, as kb_manifest lists it (node.update, ui.navigate, …)"),
      input: z.record(z.string(), z.unknown()).optional().describe("The action's input; {} when absent"),
    }),
    async execute({ id, input }, { threadId }) {
      const session = sessions.live(threadId, Date.now());
      const answer = await ask(async at => {
        const res = await callKb(at, "POST", "/api/action", {
          id,
          input: input ?? {},
          ...(session === undefined ? {} : { session }),
        });
        return receiptAnswer(res.body, res.status);
      });
      return asContent(answer);
    },
  });

  bb.agents.registerTool({
    name: "kb_screen",
    description:
      "What the person's kb tab beside this thread shows: its route, panes, focus, selection and canvas camera. Every open kb tab when no panel is open.",
    presentation: { label: { pending: "Looking at kb", completed: "Looked at kb" } },
    parameters: z.object({}),
    async execute(_args, { threadId }) {
      const session = sessions.live(threadId, Date.now());
      const answer = await ask(async at => {
        const res = await callKb(at, "POST", "/api/action", {
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
      "kb's actions: one line each (id, read or write, title, what the tab fills), or with id, that action whole with its input schema.",
    presentation: { label: { pending: "Listing kb actions", completed: "Listed kb actions" } },
    parameters: z.object({ id: z.string().min(1).optional().describe("One action to show whole") }),
    async execute({ id }) {
      const answer = await ask(async at => {
        const res = await callKb(at, "GET", "/api/manifest");
        return manifestAnswer(res.body, id);
      });
      return asContent(answer);
    },
  });
}
