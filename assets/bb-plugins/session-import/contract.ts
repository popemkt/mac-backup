// The server ↔ host contract. host.ts runs on the machine that holds the sessions (to read them) and on the machine
// a thread will run on (to write its transcript file); server.ts calls it there by host id.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Transcript } from "./core/transcript.ts";

const sessionId = z.string().regex(/^[0-9a-f-]{36}$/i, "a Claude Code session id");

export const sessionSummary = z.object({
  sessionId: z.string(),
  title: z.string().nullable(),
  firstPrompt: z.string().nullable(),
  cwd: z.string().nullable(),
  gitBranch: z.string().nullable(),
  createdAt: z.number().nullable(),
  lastModified: z.number(),
  fileSize: z.number(),
});
export type SessionSummary = z.infer<typeof sessionSummary>;

export const readStats = z.object({ bytes: z.number(), ms: z.number(), records: z.number(), peakRssMB: z.number(), clipped: z.boolean() });
export type ReadStats = z.infer<typeof readStats>;

/** Where an import ended: how many records it read, their sha256, and the last message's uuid. */
export const sourceMark = z.object({ lines: z.number().int().min(0), sha256: z.string(), leafUuid: z.string() });
export type SourceMark = z.infer<typeof sourceMark>;

export const hostContract = defineRpcContract({
  /** Claude Code sessions on this machine, newest first, modified at or after `sinceMs` (0 = all). */
  listSessions: {
    input: z.object({ sinceMs: z.number().int().min(0), limit: z.number().int().min(1).max(1000) }).strict(),
    output: z.object({ machineHome: z.string(), sessions: z.array(sessionSummary), total: z.number() }),
  },
  /**
   * One session as a transcript: the whole conversation, across compactions, without tool output; where it ends now
   * (`source`); and with `since`, the turns after that mark, or null if the session changed before it.
   */
  readTranscript: {
    input: z.object({ sessionId, since: sourceMark.optional() }).strict(),
    output: z.object({
      transcript: z.custom<Transcript>(v => typeof v === "object" && v !== null, "not a transcript"),
      stats: readStats,
      source: sourceMark,
      newTurns: z.custom<Transcript["turns"]>(v => v === null || Array.isArray(v)).nullable(),
    }),
  },
  /** The output of one tool call, read again from the session file, at most `maxChars`. */
  toolOutput: {
    input: z.object({ sessionId, toolUseId: z.string().min(1), maxChars: z.number().int().min(1).max(200_000) }).strict(),
    output: z.object({ text: z.string().nullable(), totalChars: z.number(), failed: z.boolean() }),
  },
  /** Whether a directory still exists here, and its git origin. */
  inspectCwd: {
    input: z.object({ cwd: z.string().min(1) }).strict(),
    output: z.object({ exists: z.boolean(), gitRemote: z.string().nullable() }),
  },
  /** Saves a full transcript in this plugin's data dir on this machine; returns its path for the thread to read. */
  writeTranscript: {
    input: z.object({ sessionId, markdown: z.string() }).strict(),
    output: z.object({ path: z.string(), sizeBytes: z.number() }),
  },
});
