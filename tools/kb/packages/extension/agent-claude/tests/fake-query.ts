/**
 * A fake of the Claude Agent SDK's `query` that plays a model double the way
 * Claude Code would run it: it opens the session (resuming one it holds),
 * lists the in-process MCP server's tools, and for each step streams the
 * text the model says and calls each tool it asks for through that server,
 * up to `options.maxTurns` steps. So the adapter's real `queryOptions`,
 * `outputsOf` and `kbToolServer` run, and only the model is a stand-in.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ModelDouble } from "@kb/agent";
import type { ClaudeQuery } from "../src/claude.ts";
import { KB_TOOL_SERVER } from "../src/tool-server.ts";

const message = (value: object): SDKMessage => value as SDKMessage;

const textEvent = (event: object): SDKMessage =>
  message({ type: "stream_event", parent_tool_use_id: null, event });

/** The in-process server the adapter hands Claude Code, connected to a client the fake drives. */
async function toolClient(options: Options): Promise<Client> {
  const config = options.mcpServers?.[KB_TOOL_SERVER] as { instance: McpServer } | undefined;
  if (config === undefined) throw new Error("the adapter handed Claude Code no kb tool server");
  const client = new Client({ name: "fake-claude", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([config.instance.connect(serverSide), client.connect(clientSide)]);
  return client;
}

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = (result.content ?? []) as readonly { type: string; text?: string }[];
  return content.map((part) => part.text ?? "").join("");
}

export function fakeClaude(model: ModelDouble): ClaudeQuery {
  const sessions = new Map<string, readonly string[]>();
  return ({ prompt, options }) =>
    (async function* () {
      const session = options.resume ?? crypto.randomUUID();
      const users = [...(sessions.get(session) ?? []), prompt];
      sessions.set(session, users);
      yield message({ type: "system", subtype: "init", session_id: session });
      const client = await toolClient(options);
      try {
        const tools = (await client.listTools()).tools.map((tool) => tool.name);
        const results: string[] = [];
        const signal = options.abortController?.signal;
        for (let step = 1; ; step++) {
          let called = false;
          let wrote = false;
          for (const move of model({ tools, users, results: [...results], step })) {
            if ("fail" in move) {
              yield message({
                type: "result",
                subtype: "success",
                is_error: true,
                result: move.fail,
              });
              return;
            }
            if ("say" in move) {
              if (!wrote)
                yield textEvent({ type: "content_block_start", content_block: { type: "text" } });
              wrote = true;
              yield textEvent({
                type: "content_block_delta",
                delta: { type: "text_delta", text: move.say },
              });
              continue;
            }
            called = true;
            const result = await client.callTool(
              { name: move.call, arguments: move.input as Record<string, unknown> },
              undefined,
              signal === undefined ? undefined : { signal },
            );
            results.push(resultText(result));
          }
          if (!called) {
            yield message({ type: "result", subtype: "success", is_error: false, result: "" });
            return;
          }
          if (step >= (options.maxTurns ?? Number.POSITIVE_INFINITY)) {
            yield message({ type: "result", subtype: "error_max_turns", errors: [] });
            return;
          }
        }
      } finally {
        await client.close();
      }
    })();
}
