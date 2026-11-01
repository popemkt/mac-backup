// The relay as a Codex dynamic tool. Relaying, the call's backing Codex agent has one tool, `ask_concierge`; Codex
// sends each call to the client (host.ts) as an `item/tool/call` request and waits for the answer however long the
// concierge's bb thread takes. (A shell command would not do: Codex's exec tool hands back after ~10 s and the
// agent then answers with nothing.)

export const ASK_TOOL = "ask_concierge";

export const ASK_TOOL_SPEC = {
  type: "function",
  name: ASK_TOOL,
  description:
    "Ask the concierge's own bb thread, which can see and act on bb, and get its reply, already short and written to be spoken. Takes a few seconds to a minute.",
  inputSchema: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description: "The person's request in their words, with whatever from the call is needed to understand it on its own; keep a trailing \"(confirmed)\".",
      },
    },
    required: ["request"],
    additionalProperties: false,
  },
} as const;

export interface ToolCallResponse {
  contentItems: { type: "inputText"; text: string }[];
  success: boolean;
}

/** Answer one `item/tool/call` request; `ask` sends the request to the concierge's thread and returns its reply. */
export async function answerToolCall(params: unknown, ask: (request: string) => Promise<string>): Promise<ToolCallResponse> {
  const p = (params ?? {}) as { tool?: unknown; arguments?: unknown };
  const reply = (text: string, success: boolean): ToolCallResponse => ({ contentItems: [{ type: "inputText", text }], success });
  if (p.tool !== ASK_TOOL) return reply(`Unknown tool ${String(p.tool)}`, false);
  const args = (typeof p.arguments === "string" ? safeJson(p.arguments) : p.arguments) as { request?: unknown } | null;
  const request = typeof args?.request === "string" ? args.request.trim() : "";
  if (request === "") return reply("No request given", false);
  try {
    const text = (await ask(request)).trim();
    return text === "" ? reply("The concierge's thread gave no answer.", false) : reply(text, true);
  } catch (e) {
    return reply(`The concierge's thread could not answer: ${e instanceof Error ? e.message : String(e)}`, false);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
