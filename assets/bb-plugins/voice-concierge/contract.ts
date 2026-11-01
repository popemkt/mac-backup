// bb-plugin-voice-concierge — the host contract: what the server asks the host entry (host.ts) on the machine that runs
// the voice backend's agent. Shared by server.ts and host.ts; validated at the RPC boundary on both sides.
import { defineRpcContract, type ExperimentalHostSignals } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Where Codex keeps its login and threads: the plugin's own home on that host, or the person's ~/.codex. */
export const codexHomeMode = z.enum(["dedicated", "user"]);
export type CodexHomeMode = z.infer<typeof codexHomeMode>;

const home = z.object({ codexHome: codexHomeMode });

export const probeResult = z.object({
  codexPath: z.string().nullable(),
  codexVersion: z.string().nullable(),
  /** "chatgpt" | "apiKey" | null when signed out. */
  authType: z.string().nullable(),
  account: z.string().nullable(),
  bbPath: z.string().nullable(),
  message: z.string(),
});
export type ProbeResult = z.infer<typeof probeResult>;

export const hostContract = defineRpcContract({
  probe: { input: home, output: probeResult, experimental_retryable: true },
  loginStart: {
    input: home,
    output: z.object({ verificationUrl: z.string(), userCode: z.string(), loginId: z.string() }),
  },
  logout: { input: home, output: z.object({ ok: z.boolean() }) },
  start: {
    input: home.extend({
      /** The concierge's Codex thread to resume, or null to start one. */
      threadId: z.string().nullable(),
      sdp: z.string().min(1),
      voice: z.string().nullable(),
      version: z.enum(["v1", "v3"]),
      voicePrompt: z.string(),
      agentInstructions: z.string(),
      /** Relay to the concierge's bb thread: a fresh ephemeral backing thread with the ask_concierge tool. */
      relay: z.boolean(),
    }),
    output: z.object({ threadId: z.string(), sdp: z.string() }),
  },
  sendText: { input: z.object({ threadId: z.string(), text: z.string().min(1).max(4000) }), output: z.object({ ok: z.boolean() }) },
  stop: { input: z.object({ threadId: z.string() }), output: z.object({ ok: z.boolean() }) },
});

export const voiceEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transcript"), role: z.string(), text: z.string(), final: z.boolean() }),
  /** What the backing agent is doing ("working" while it runs a turn or a command). */
  z.object({ kind: z.literal("activity"), state: z.enum(["working", "idle"]), detail: z.string().nullable() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({ kind: z.literal("closed"), reason: z.string().nullable() }),
  z.object({ kind: z.literal("login"), success: z.boolean(), error: z.string().nullable() }),
]);
export type VoiceEvent = z.infer<typeof voiceEvent>;

export const hostSignals = {
  event: { payload: z.object({ threadId: z.string().nullable(), event: voiceEvent }) },
} satisfies ExperimentalHostSignals;
