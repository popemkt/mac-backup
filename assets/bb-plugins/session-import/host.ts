// bb-plugin-session-import — the host entry. Runs in the host daemon of the machine a call names: it lists and reads
// that machine's Claude Code sessions (read-only; nothing under ~/.claude is ever written) and stores transcript
// files for threads in this plugin's own data dir.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { listSessions as sdkListSessions } from "@anthropic-ai/claude-agent-sdk";
import { hostContract, type ReadStats, type SessionSummary, type SourceMark } from "./contract.ts";
import { SessionReader, type Transcript } from "./core/transcript.ts";

/** bb's host RPC answers at most 8 MiB; leave room for the envelope. */
const MAX_OUTPUT_CHARS = 7 * 1024 * 1024;

export function projectsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

/** Session id → file, over every project dir (one readdir each). */
export function sessionFiles(root = projectsRoot()): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(root)) return files;
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = join(root, dir.name);
    for (const f of readdirSync(full)) {
      if (f.endsWith(".jsonl")) files.set(f.slice(0, -".jsonl".length), join(full, f));
    }
  }
  return files;
}

function fileOf(sessionId: string): string {
  const path = sessionFiles().get(sessionId);
  if (path === undefined) throw new Error(`No Claude Code session ${sessionId} on this machine`);
  return path;
}

export async function listSessions(sinceMs: number, limit: number): Promise<{ machineHome: string; sessions: SessionSummary[]; total: number }> {
  const files = sessionFiles();
  // The Agent SDK owns the session format's metadata (titles, first prompt, cwd); it reads only each file's head
  // and tail. Sizes and times come from the file itself.
  const infos = await sdkListSessions({});
  const sessions: SessionSummary[] = [];
  for (const s of infos) {
    const path = files.get(s.sessionId);
    if (path === undefined) continue;
    const st = statSync(path);
    if (st.mtimeMs < sinceMs) continue;
    sessions.push({
      sessionId: s.sessionId,
      title: s.customTitle ?? s.summary ?? null,
      firstPrompt: s.firstPrompt === undefined ? null : s.firstPrompt.slice(0, 300),
      cwd: s.cwd ?? null,
      gitBranch: s.gitBranch ?? null,
      createdAt: s.createdAt ?? null,
      lastModified: Math.round(st.mtimeMs),
      fileSize: st.size,
    });
  }
  sessions.sort((a, b) => b.lastModified - a.lastModified);
  return { machineHome: homedir(), sessions: sessions.slice(0, limit), total: sessions.length };
}

/**
 * Streams a session file through `visit`, one parsed record at a time. Torn or non-JSON lines are skipped and not
 * counted. Returns how many records it read and a sha256 over them (each line plus a newline), and, with `checkpointAt`,
 * the hash of the first that many: a later read compares it to tell an appended file from a rewritten one.
 */
async function eachRecord(
  path: string,
  signal: AbortSignal,
  visit: (record: unknown) => boolean | void,
  checkpointAt?: number,
): Promise<{ lines: number; sha256: string; checkpoint: string | null }> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const hash = createHash("sha256");
  let count = 0;
  let checkpoint: string | null = checkpointAt === 0 ? hash.copy().digest("hex") : null;
  try {
    for await (const line of lines) {
      if (signal.aborted) throw new Error("cancelled");
      if (line.length === 0) continue;
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      hash.update(line).update("\n");
      count++;
      if (count === checkpointAt) checkpoint = hash.copy().digest("hex");
      if (visit(record) === true) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return { lines: count, sha256: hash.digest("hex"), checkpoint };
}

/** Shortens every text until the transcript fits in one RPC answer. Only a many-megabyte conversation needs it. */
export function fitForTransport(t: Transcript, max = MAX_OUTPUT_CHARS): { transcript: Transcript; clipped: boolean } {
  if (JSON.stringify(t).length <= max) return { transcript: t, clipped: false };
  for (const limit of [20_000, 4_000, 1_000, 200]) {
    const clip = (s: string) => (s.length > limit ? `${s.slice(0, limit)}… [clipped]` : s);
    const next: Transcript = {
      ...t,
      turns: t.turns.map(turn =>
        turn.kind === "compaction"
          ? { ...turn, summary: turn.summary === null ? null : clip(turn.summary) }
          : {
              ...turn,
              user: turn.user === null ? null : { ...turn.user, text: clip(turn.user.text) },
              blocks: turn.blocks.map(b => (b.kind === "text" ? { ...b, text: clip(b.text) } : b)),
            },
      ),
    };
    if (JSON.stringify(next).length <= max) return { transcript: next, clipped: true };
  }
  return { transcript: { ...t, turns: t.turns.slice(-200) }, clipped: true };
}

/**
 * One session as a transcript. With `since` (where an earlier import ended), also the turns after it, or null when
 * the file no longer starts with what that import read (rewritten) or that record left the main chain (rewound).
 */
export async function readTranscript(
  sessionId: string,
  signal: AbortSignal,
  since?: SourceMark,
): Promise<{ transcript: Transcript; stats: ReadStats; source: SourceMark; newTurns: Transcript["turns"] | null }> {
  const path = fileOf(sessionId);
  const started = Date.now();
  const reader = new SessionReader();
  const read = await eachRecord(path, signal, r => reader.add(r), since?.lines);
  const full = reader.finish(sessionId);
  const { transcript, clipped } = fitForTransport(full);
  let newTurns: Transcript["turns"] | null = null;
  if (since !== undefined && read.checkpoint === since.sha256) newTurns = reader.finish(sessionId, since.leafUuid)?.turns ?? null;
  return {
    transcript,
    stats: {
      bytes: statSync(path).size,
      ms: Date.now() - started,
      records: reader.records,
      peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
      clipped,
    },
    source: { lines: read.lines, sha256: read.sha256, leafUuid: full.leafUuid ?? "" },
    newTurns,
  };
}

export async function toolOutput(sessionId: string, toolUseId: string, maxChars: number, signal: AbortSignal) {
  let found: { text: string | null; totalChars: number; failed: boolean } = { text: null, totalChars: 0, failed: false };
  await eachRecord(fileOf(sessionId), signal, record => {
    const content = (record as { message?: { content?: unknown } })?.message?.content;
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (part?.type !== "tool_result" || part.tool_use_id !== toolUseId) continue;
      const c = part.content;
      const text =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? c.map((p: { type?: string; text?: string }) => (p?.type === "text" ? (p.text ?? "") : `[${p?.type ?? "part"}]`)).join("\n")
            : "";
      found = { text: text.length > maxChars ? `${text.slice(0, maxChars)}… [${text.length - maxChars} more characters]` : text, totalChars: text.length, failed: part.is_error === true };
      return true;
    }
  });
  return found;
}

export function inspectCwd(cwd: string): Promise<{ exists: boolean; gitRemote: string | null }> {
  if (!existsSync(cwd)) return Promise.resolve({ exists: false, gitRemote: null });
  return new Promise(resolve => {
    execFile("git", ["-C", cwd, "remote", "get-url", "origin"], { timeout: 5_000 }, (err, stdout) => {
      resolve({ exists: true, gitRemote: err === null && stdout.trim().length > 0 ? stdout.trim() : null });
    });
  });
}

export async function writeTranscript(dataDir: string, sessionId: string, markdown: string) {
  const dir = join(dataDir, "transcripts");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${sessionId}.md`);
  await writeFile(path, markdown, "utf8");
  return { path, sizeBytes: Buffer.byteLength(markdown) };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    listSessions: ({ sinceMs, limit }) => listSessions(sinceMs, limit),
    readTranscript: ({ sessionId, since }, context) => readTranscript(sessionId, context.signal, since),
    toolOutput: ({ sessionId, toolUseId, maxChars }, context) => toolOutput(sessionId, toolUseId, maxChars, context.signal),
    inspectCwd: ({ cwd }) => inspectCwd(cwd),
    writeTranscript: ({ sessionId, markdown }, context) => writeTranscript(context.experimental_paths.dataDir, sessionId, markdown),
  },
});
