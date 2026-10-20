// The server ↔ host contract. host.ts runs on the machine a thread's workspace lives on; server.ts calls it there.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ClaudeProbe } from "./lib/claude";

export const hostContract = defineRpcContract({
  /**
   * Claude Code's own view of `cwd`: a session started there that is never sent a prompt (no model call), asked
   * for its skills, agents, commands, MCP servers and startup context, plus the settings files it reads.
   */
  probeClaude: {
    input: z.object({ cwd: z.string().min(1), mcpWaitMs: z.number().int().min(0).max(15_000).optional() }).strict(),
    output: z.custom<ClaudeProbe>(v => typeof v === "object" && v !== null, "not a Claude probe"),
  },
});
