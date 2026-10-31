// A bb thread's events as an ATIF trajectory (Harbor's Agent Trajectory Interchange Format,
// v1.8; docs/research/2026-10-31-sandboxes.md §10). Pure, so it is tested on recorded events.
// ATIF rejects undeclared fields: anything bb-specific goes in `extra`.
//
// Mapping: a user turn (client/turn/requested) is a `user` step; each completed agent item is an
// `agent` step: a message, reasoning, or one tool call with its observation (shell commands,
// plugin and MCP tools, web fetch and search, file changes). Token totals come from the last
// thread/tokenUsage/updated.

export const ATIF_VERSION = "ATIF-v1.8";

/** The fields of a bb thread event row this reads; the rest are ignored. */
export interface EventRow {
  type: string;
  createdAt: number;
  data: unknown;
}

interface ToolCall {
  tool_call_id: string;
  function_name: string;
  arguments: Record<string, unknown>;
}

export interface Step {
  step_id: number;
  source: "system" | "user" | "agent";
  message: string;
  timestamp: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  observation?: { results: Array<{ source_call_id: string; content: string }> };
  extra?: Record<string, unknown>;
}

export interface Trajectory {
  schema_version: typeof ATIF_VERSION;
  session_id: string;
  agent: { name: string; version: string; model_name: string };
  steps: Step[];
  final_metrics: {
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_cached_tokens: number;
    total_steps: number;
  };
  extra?: Record<string, unknown>;
}

type Item = Record<string, unknown> & { type: string; id?: string };

const text = (value: unknown): string => (typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value));
const args = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : value === undefined ? {} : { value };

/** One completed item as a step, or null for items a trajectory does not keep. */
function itemStep(item: Item): Omit<Step, "step_id" | "timestamp"> | null {
  const id = item.id ?? "";
  const call = (name: string, input: Record<string, unknown>, output: unknown, extra?: Record<string, unknown>) => ({
    source: "agent" as const,
    message: "",
    tool_calls: [{ tool_call_id: id, function_name: name, arguments: input }],
    observation: { results: [{ source_call_id: id, content: text(output) }] },
    ...(extra ? { extra } : {}),
  });
  switch (item.type) {
    case "agentMessage":
      return { source: "agent", message: text(item.text) };
    case "reasoning": {
      const parts = [...((item.summary as string[]) ?? []), ...((item.content as string[]) ?? [])];
      return { source: "agent", message: "", reasoning_content: parts.join("\n") };
    }
    case "commandExecution":
      return call("shell", { command: item.command, cwd: item.cwd }, item.aggregatedOutput ?? "", {
        exit_code: item.exitCode ?? null,
        status: item.status,
      });
    case "toolCall":
    case "mcpToolCall":
      return call(text(item.server ? `${item.server}.${item.tool}` : item.tool), args(item.arguments), item.result ?? item.error ?? "", {
        status: item.status,
      });
    case "webFetch":
      return call("web_fetch", { url: item.url, prompt: item.prompt }, item.resultText ?? item.error ?? "");
    case "webSearch":
      return call("web_search", { queries: item.queries }, item.resultText ?? "");
    case "fileChange": {
      const changes = (item.changes as Array<Record<string, unknown>>) ?? [];
      return call(
        "file_change",
        { changes: changes.map((c) => ({ path: c.path, kind: c.kind })) },
        changes.map((c) => c.diff ?? "").join("\n"),
        { status: item.status },
      );
    }
    default:
      return null;
  }
}

export function toTrajectory(
  events: EventRow[],
  meta: { sessionId: string; harness: string; model: string; extra?: Record<string, unknown> },
): Trajectory {
  const steps: Step[] = [];
  const totals = { prompt: 0, completion: 0, cached: 0 };
  const push = (at: number, step: Omit<Step, "step_id" | "timestamp">) =>
    steps.push({ step_id: steps.length + 1, timestamp: new Date(at).toISOString(), ...step });
  for (const event of [...events].sort((a, b) => a.createdAt - b.createdAt)) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.type === "client/turn/requested") {
      const input = (data.input as Array<Record<string, unknown>>) ?? [];
      const message = input
        .filter((part) => part.type === "text")
        .map((part) => text(part.text))
        .join("\n");
      if (message) push(event.createdAt, { source: "user", message });
    } else if (event.type === "item/completed") {
      const item = data.item as Item | undefined;
      // Sub-agent items belong to the delegation that ran them, not to this agent's steps.
      if (!item || item.parentToolCallId) continue;
      const step = itemStep(item);
      if (step) push(event.createdAt, step);
    } else if (event.type === "thread/tokenUsage/updated") {
      const total = ((data.tokenUsage as Record<string, unknown>)?.total ?? {}) as Record<string, number>;
      totals.prompt = total.inputTokens ?? totals.prompt;
      totals.completion = total.outputTokens ?? totals.completion;
      totals.cached = total.cachedInputTokens ?? totals.cached;
    }
  }
  return {
    schema_version: ATIF_VERSION,
    session_id: meta.sessionId,
    agent: { name: meta.harness, version: "bb", model_name: meta.model },
    steps,
    final_metrics: {
      total_prompt_tokens: totals.prompt,
      total_completion_tokens: totals.completion,
      total_cached_tokens: totals.cached,
      total_steps: steps.length,
    },
    ...(meta.extra ? { extra: meta.extra } : {}),
  };
}
