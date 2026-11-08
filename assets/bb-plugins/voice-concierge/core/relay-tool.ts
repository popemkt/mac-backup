// The relay as a Codex dynamic tool. Relaying, the call's backing Codex agent has one tool, `ask_concierge`; Codex
// sends each call to the client (host.ts) as an `item/tool/call` request and waits for the answer however long the
// bb thread the call is connected to takes (the concierge's own, or the thread the call was started from). (A shell command would not do: Codex's exec tool hands back after ~10 s and the
// agent then answers with nothing.)

export const ASK_TOOL = "ask_concierge";

export const ASK_TOOL_SPEC = {
  type: "function",
  name: ASK_TOOL,
  description:
    "Ask the bb thread this call is connected to (the concierge's own thread, which oversees bb, or the thread the person started the call from) and get its reply, already short and written to be spoken. Takes a few seconds to a few minutes.",
  inputSchema: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description:
          "The request as the person would type it: short, in their words, first person, with only the context needed to understand it on its own (it shows in their conversation). Add \"(confirmed)\" at the end when they confirmed it.",
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

/**
 * Answer one `item/tool/call` request; `ask` sends the request to the call's thread and returns its reply. `call` is
 * the Codex thread the tool call came from, which is the call's id: the server looks up which bb thread it targets.
 */
export async function answerToolCall(params: unknown, ask: (request: string, call: string | null) => Promise<string>): Promise<ToolCallResponse> {
  const p = (params ?? {}) as { tool?: unknown; arguments?: unknown; threadId?: unknown };
  const reply = (text: string, success: boolean): ToolCallResponse => ({ contentItems: [{ type: "inputText", text }], success });
  if (p.tool !== ASK_TOOL) return reply(`Unknown tool ${String(p.tool)}`, false);
  const args = (typeof p.arguments === "string" ? safeJson(p.arguments) : p.arguments) as { request?: unknown } | null;
  const request = typeof args?.request === "string" ? args.request.trim() : "";
  if (request === "") return reply("No request given", false);
  try {
    const text = (await ask(request, typeof p.threadId === "string" ? p.threadId : null)).trim();
    return text === "" ? reply("The thread gave no answer.", false) : reply(text, true);
  } catch (e) {
    return reply(`The thread could not answer: ${e instanceof Error ? e.message : String(e)}`, false);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
