// bb-plugin-session-import — the backend. Lists Claude Code sessions on every machine bb reaches (through the host
// entry, host.ts), previews one as a handoff, and imports it: a new thread in the session's own directory on the
// session's own machine (by default), whose first turn carries the cleaned transcript. Serves the app (RPC) and
// terminals and agents (`bb session-import`). It never writes a session file; it writes one transcript file per
// import, in its own data dir on the machine the thread runs on.
import { defineRpcContract, type BbPluginApi, type PluginBbSdk } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, readStats, sessionSummary, type ReadStats, type SessionSummary } from "./contract.ts";
import { environmentFor, resolveTarget, type CwdFacts, type ProjectInfo, type Target } from "./core/mapping.ts";
import {
  DEFAULT_BUDGET_TOKENS,
  fullMarkdown,
  headerMarkdown,
  seedMarkdown,
  turnMarkdown,
  type Origin,
  type Plan,
  type Transcript,
} from "./core/transcript.ts";

export const PROVIDER_ID = "claude-code";
const DAY_MS = 86_400_000;
/** Reading a 160 MB session takes seconds; give the host minutes, not bb's 30 s default. */
const READ_TIMEOUT_MS = 5 * 60_000;
const TRANSCRIPT_CACHE_MS = 2 * 60_000;
const FIRST_MESSAGE_DEFAULT = "Summarise where this session stood in at most 5 lines, then wait for my next message.";

const importRecord = z.object({
  threadId: z.string(),
  importedAt: z.number(),
  hostId: z.string(),
  sourceModified: z.number(),
});
export type ImportRecord = z.infer<typeof importRecord>;

/** What an imported thread remembers about its source, in its plugin metadata. */
const threadRecord = z.object({
  source: z.literal("claude-code"),
  sessionId: z.string(),
  hostId: z.string(),
  machine: z.string(),
  cwd: z.string().nullable(),
  title: z.string().nullable(),
  transcriptHostId: z.string(),
  transcriptPath: z.string(),
  importedAt: z.number(),
  sourceModified: z.number(),
  plan: z.custom<Plan>(v => typeof v === "object" && v !== null),
});
export type ThreadRecord = z.infer<typeof threadRecord>;

const machine = z.object({ id: z.string(), name: z.string(), connected: z.boolean(), isServer: z.boolean() });
export type Machine = z.infer<typeof machine>;

const targetSchema = z.custom<Target>(v => typeof v === "object" && v !== null);
const listedSession = sessionSummary.extend({
  imports: z.array(importRecord),
  /** The bb thread that already runs this session natively (bb's own Claude Code threads write here too). */
  ownedByThreadId: z.string().nullable(),
});
export type ListedSession = z.infer<typeof listedSession>;

const sourceInput = z.object({ hostId: z.string().min(1), sessionId: z.string().min(1) });
const targetInput = sourceInput.extend({
  targetHostId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  budget: z.number().int().min(2_000).max(400_000).optional(),
});

export const rpcContract = defineRpcContract({
  machines: { input: z.object({}), output: z.object({ machines: z.array(machine) }) },
  sessions: {
    input: z.object({ hostId: z.string().min(1), sinceDays: z.number().int().min(0).max(3650) }),
    output: z.object({ total: z.number(), sessions: z.array(listedSession) }),
  },
  preview: {
    input: targetInput,
    output: z.object({
      header: z.string(),
      opening: z.string(),
      ending: z.string(),
      plan: z.custom<Plan>(v => typeof v === "object" && v !== null),
      target: targetSchema,
      environmentError: z.string().nullable(),
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
      imports: z.array(importRecord),
      stats: readStats,
    }),
  },
  importSession: {
    input: targetInput.extend({
      providerId: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      firstMessage: z.string().optional(),
    }),
    output: z.object({ threadId: z.string(), plan: z.custom<Plan>(v => typeof v === "object" && v !== null), transcriptPath: z.string() }),
  },
  original: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({
      record: threadRecord.nullable(),
      transcript: z.custom<Transcript>(v => v === null || (typeof v === "object" && v !== null)).nullable(),
      reason: z.string().nullable(),
    }),
  },
  toolOutput: {
    input: z.object({ threadId: z.string().min(1), toolUseId: z.string().min(1) }),
    output: z.object({ text: z.string().nullable(), totalChars: z.number(), failed: z.boolean() }),
  },
});

type Sdk = PluginBbSdk;
type HostCall = <M extends keyof typeof hostContract & string>(
  method: M,
  input: z.input<(typeof hostContract)[M]["input"]>,
  hostId: string,
  timeoutMs?: number,
) => Promise<z.output<(typeof hostContract)[M]["output"]>>;

export function parseThreadRecord(value: unknown): ThreadRecord | null {
  const r = threadRecord.safeParse((value as { imported?: unknown } | null)?.imported);
  return r.success ? r.data : null;
}

/** The text of the thread's first turn before the person's own message: what the agent is, and the transcript. */
export function preamble(t: Transcript, origin: Origin, plan: Plan, transcriptPath: string): string {
  const cut = plan.omitted > 0 || plan.condensed > 0;
  return [
    `This thread continues a Claude Code session that ran outside bb: session ${t.sessionId} on ${origin.machine}` +
      `${t.cwd === null ? "" : `, in ${t.cwd}`}. Its transcript follows, cleaned: messages in full, one line per tool call, tool output left out` +
      `${cut ? `, and to fit, ${plan.omitted > 0 ? `${plan.omitted} older turns omitted` : ""}${plan.omitted > 0 && plan.condensed > 0 ? " and " : ""}${plan.condensed > 0 ? `${plan.condensed} older turns without their tool lines` : ""}` : ""}.`,
    `The complete transcript is the attached file ${transcriptPath}; read it when you need something left out here.`,
    "Files may have changed since the session ended: check before relying on what the transcript says about them. Do not redo work it shows as done.",
  ].join(" ");
}

export default async function plugin(bb: BbPluginApi) {
  const sdk: Sdk = bb.sdk;
  const client = bb.hosts.experimental_client({ contract: hostContract });
  const host: HostCall = (method, input, hostId, timeoutMs) =>
    client.call(method, input as never, { hostId, ...(timeoutMs === undefined ? {} : { timeoutMs }) }) as never;

  async function machines(): Promise<Machine[]> {
    const [hosts, config] = await Promise.all([sdk.hosts.list(), sdk.system.config().catch(() => null)]);
    return hosts
      .filter(h => h.lifecycle.phase === "active")
      .map(h => ({ id: h.id, name: h.name, connected: h.status === "connected", isServer: h.id === config?.primaryHostId }))
      .sort((a, b) => Number(b.isServer) - Number(a.isServer) || a.name.localeCompare(b.name));
  }
  async function machineName(hostId: string): Promise<string> {
    return (await machines()).find(m => m.id === hostId)?.name ?? hostId;
  }
  async function projects(): Promise<ProjectInfo[]> {
    const list = await sdk.projects.list({ includePersonal: true });
    return list.map(p => ({
      id: p.id,
      name: p.name,
      gitRemoteUrl: p.gitRemoteUrl,
      sources: p.sources.map(s => ({ hostId: s.hostId, path: s.path, isDefault: s.isDefault })),
    }));
  }

  // ---------------------------------------------------------------- imports this plugin made
  const importsKey = (sessionId: string) => `import/${sessionId}`;
  async function importsOf(sessionId: string): Promise<ImportRecord[]> {
    const r = z.array(importRecord).safeParse(await bb.storage.kv.get(importsKey(sessionId)));
    return r.success ? r.data : [];
  }

  // ---------------------------------------------------------------- sessions bb threads already own
  // providerThreadId → threadId, from each Claude Code thread's `thread/identity` event. A thread's identity never
  // changes once set, so a thread is looked up once per plugin load.
  const identities = new Map<string, string | null>();
  async function ownedSessions(): Promise<Map<string, string>> {
    const threads = await sdk.threads.list({ limit: 1000, includeHidden: true });
    const todo = threads.filter(t => t.providerId === PROVIDER_ID && !identities.has(t.id));
    for (let i = 0; i < todo.length; i += 16) {
      await Promise.all(
        todo.slice(i, i + 16).map(async t => {
          const rows = await sdk.threads.events.list({ threadId: t.id, types: ["thread/identity"], limit: "1", order: "desc" }).catch(() => []);
          const row = rows[0] as { providerThreadId?: unknown; data?: { providerThreadId?: unknown } } | undefined;
          const id = row?.providerThreadId ?? row?.data?.providerThreadId;
          // Not cached when the thread has no identity yet: it may get one on its first turn.
          if (typeof id === "string") identities.set(t.id, id);
        }),
      );
    }
    const owned = new Map<string, string>();
    for (const [threadId, sessionId] of identities) if (sessionId !== null) owned.set(sessionId, threadId);
    return owned;
  }

  async function sessions(hostId: string, sinceDays: number) {
    const sinceMs = sinceDays === 0 ? 0 : Date.now() - sinceDays * DAY_MS;
    const [listed, owned] = await Promise.all([host("listSessions", { sinceMs, limit: 500 }, hostId), ownedSessions().catch(() => new Map<string, string>())]);
    const out: ListedSession[] = [];
    for (const s of listed.sessions) out.push({ ...s, imports: await importsOf(s.sessionId), ownedByThreadId: owned.get(s.sessionId) ?? null });
    return { total: listed.total, sessions: out };
  }

  // ---------------------------------------------------------------- reading, shared by preview and import
  const transcripts = new Map<string, { at: number; value: Promise<{ transcript: Transcript; stats: ReadStats }> }>();
  function read(hostId: string, sessionId: string, fresh = false) {
    const key = `${hostId}:${sessionId}`;
    const hit = transcripts.get(key);
    if (!fresh && hit !== undefined && Date.now() - hit.at < TRANSCRIPT_CACHE_MS) return hit.value;
    const value = host("readTranscript", { sessionId }, hostId, READ_TIMEOUT_MS);
    transcripts.set(key, { at: Date.now(), value });
    value.catch(() => transcripts.delete(key));
    return value;
  }

  async function plan(input: z.infer<typeof targetInput>, fresh = false) {
    const [{ transcript, stats }, all, name] = await Promise.all([read(input.hostId, input.sessionId, fresh), projects(), machineName(input.hostId)]);
    const facts: CwdFacts | null = transcript.cwd === null ? null : await host("inspectCwd", { cwd: transcript.cwd }, input.hostId).catch(() => null);
    const target = resolveTarget({
      projects: all,
      session: { hostId: input.hostId, cwd: transcript.cwd },
      facts,
      ...(input.targetHostId === undefined ? {} : { targetHostId: input.targetHostId }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    });
    const env = environmentFor(target, all);
    const origin: Origin = { machine: name };
    const seed = seedMarkdown(transcript, origin, input.budget ?? DEFAULT_BUDGET_TOKENS);
    return { transcript, stats, all, target, env, origin, seed };
  }

  async function preview(input: z.infer<typeof targetInput>) {
    const p = await plan(input);
    const turns = p.transcript.turns;
    return {
      header: headerMarkdown(p.transcript, p.origin),
      opening: turns.slice(0, 2).map(t => turnMarkdown(t)).join("\n\n"),
      ending: turns.length <= 2 ? "" : turns.slice(-2).map(t => turnMarkdown(t)).join("\n\n"),
      plan: p.seed.plan,
      target: p.target,
      environmentError: "error" in p.env ? p.env.error : null,
      projects: p.all.map(x => ({ id: x.id, name: x.name })),
      imports: await importsOf(input.sessionId),
      stats: p.stats,
    };
  }

  async function importSession(input: z.infer<(typeof rpcContract)["importSession"]["input"]>) {
    const p = await plan(input, true);
    if ("error" in p.env) throw new Error(p.env.error);
    const t = p.transcript;
    const written = await host("writeTranscript", { sessionId: t.sessionId, markdown: fullMarkdown(t, p.origin) }, p.target.hostId);
    const sourceModified = Date.parse(t.endedAt ?? "") || Date.now();
    const record: ThreadRecord = {
      source: "claude-code",
      sessionId: t.sessionId,
      hostId: input.hostId,
      machine: p.origin.machine,
      cwd: t.cwd,
      title: t.title,
      transcriptHostId: p.target.hostId,
      transcriptPath: written.path,
      importedAt: Date.now(),
      sourceModified,
      plan: p.seed.plan,
    };
    const first = input.firstMessage?.trim() ?? "";
    const providerId = input.providerId ?? PROVIDER_ID;
    const thread = await sdk.threads.spawn({
      projectId: p.target.projectId!,
      environment: p.env,
      providerId,
      ...(input.model === undefined ? {} : { model: input.model }),
      executionInputSources: { providerId: "explicit", ...(input.model === undefined ? {} : { model: "explicit" as const }) },
      title: `↪ ${(t.title ?? t.sessionId).slice(0, 80)}`,
      input: [
        { type: "text", text: `${preamble(t, p.origin, p.seed.plan, written.path)}\n\n${p.seed.markdown}`, mentions: [], visibility: "agent-only" },
        {
          type: "localFile",
          hostId: p.target.hostId,
          path: written.path,
          name: `${t.sessionId}.md`,
          mimeType: "text/markdown",
          sizeBytes: written.sizeBytes,
          visibility: "agent-only",
        },
        { type: "text", text: first.length > 0 ? first : FIRST_MESSAGE_DEFAULT, mentions: [] },
      ],
      // Through JSON: the metadata type is a JSON object, and the record is one.
      pluginMetadata: JSON.parse(JSON.stringify({ imported: record })),
    });
    const imports = [...(await importsOf(t.sessionId)), { threadId: thread.id, importedAt: record.importedAt, hostId: input.hostId, sourceModified }];
    await bb.storage.kv.set(importsKey(t.sessionId), imports);
    return { threadId: thread.id, plan: p.seed.plan, transcriptPath: written.path };
  }

  async function recordOf(threadId: string): Promise<ThreadRecord | null> {
    return parseThreadRecord(await sdk.threads.getPluginMetadata({ threadId, pluginId: bb.pluginId }).catch(() => null));
  }

  bb.rpc.register(rpcContract, {
    machines: async () => ({ machines: await machines() }),
    sessions: ({ hostId, sinceDays }) => sessions(hostId, sinceDays),
    preview: input => preview(input),
    importSession: input => importSession(input),
    original: async ({ threadId }) => {
      const record = await recordOf(threadId);
      if (record === null) return { record: null, transcript: null, reason: "This thread was not imported from a Claude Code session." };
      try {
        return { record, transcript: (await read(record.hostId, record.sessionId)).transcript, reason: null };
      } catch (err) {
        return { record, transcript: null, reason: `Could not read the session on ${record.machine}: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    toolOutput: async ({ threadId, toolUseId }) => {
      const record = await recordOf(threadId);
      if (record === null) throw new Error("This thread was not imported from a Claude Code session.");
      return host("toolOutput", { sessionId: record.sessionId, toolUseId, maxChars: 50_000 }, record.hostId, READ_TIMEOUT_MS);
    },
  });

  bb.cli.register({
    name: "session-import",
    summary: "List Claude Code sessions on any machine bb reaches, and continue one as a new bb thread.",
    commands: [
      { name: "machines", summary: "Machines bb reaches", usage: "bb session-import machines" },
      { name: "list", summary: "Sessions on a machine", usage: "bb session-import list [--machine <name|id>] [--days N|--all] [--cwd <text>] [--json]" },
      { name: "show", summary: "Preview a session as a handoff", usage: "bb session-import show <session-id> [--machine <name|id>] [--full]" },
      { name: "import", summary: "Start a thread from a session", usage: "bb session-import import <session-id> [--machine m] [--to m] [--project id] [--prompt text] [--budget N]" },
    ],
    run: argv => cli(argv),
  });

  // ---------------------------------------------------------------- CLI
  async function cli(argv: string[]) {
    const [cmd, ...rest] = argv;
    const opts = new Map<string, string>();
    const flags = new Set<string>();
    const positionals: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (["--json", "--all", "--full"].includes(a)) flags.add(a);
      else if (a.startsWith("--")) opts.set(a, rest[++i] ?? "");
      else positionals.push(a);
    }
    if (cmd === undefined || cmd === "help" || argv.includes("--help") || argv.includes("-h")) return { exitCode: 0, stdout: HELP };
    try {
      const all = await machines();
      const pick = (v: string | undefined) => {
        if (v === undefined) return all.find(m => m.isServer) ?? all[0];
        return all.find(m => m.id === v || m.name === v);
      };
      const m = pick(opts.get("--machine"));
      if (m === undefined) return { exitCode: 2, stderr: `No machine ${opts.get("--machine") ?? ""}; see \`bb session-import machines\`.` };
      switch (cmd) {
        case "machines":
          return { exitCode: 0, stdout: all.map(x => `${x.name}\t${x.id}\t${x.connected ? "connected" : "offline"}${x.isServer ? "\tserver" : ""}`).join("\n") };
        case "list": {
          const days = flags.has("--all") ? 0 : Number(opts.get("--days") ?? 30);
          const { sessions: list, total } = await sessions(m.id, days);
          const cwd = opts.get("--cwd");
          const shown = (cwd === undefined ? list : list.filter(s => s.cwd?.includes(cwd))).slice(0, 100);
          if (flags.has("--json")) return { exitCode: 0, stdout: JSON.stringify(shown) };
          const lines = shown.map(s => {
            const badge = s.ownedByThreadId !== null ? ` [in bb: ${s.ownedByThreadId}]` : s.imports.length > 0 ? ` [imported: ${s.imports.at(-1)!.threadId}]` : "";
            return `${s.sessionId}  ${new Date(s.lastModified).toISOString().slice(0, 16)}  ${(s.fileSize / 1e6).toFixed(1)}MB  ${s.cwd ?? "?"}\n    ${(s.title ?? s.firstPrompt ?? "").slice(0, 100)}${badge}`;
          });
          return { exitCode: 0, stdout: `${m.name}: ${shown.length} of ${total} sessions${days > 0 ? ` from the last ${days} days` : ""}\n${lines.join("\n")}` };
        }
        case "show":
        case "import": {
          const sessionId = positionals[0];
          if (sessionId === undefined) return { exitCode: 2, stderr: `Usage: bb session-import ${cmd} <session-id> [--machine <name|id>]` };
          const to = opts.get("--to") === undefined ? undefined : pick(opts.get("--to"));
          if (opts.get("--to") !== undefined && to === undefined) return { exitCode: 2, stderr: `No machine ${opts.get("--to")}` };
          const budget = opts.get("--budget") === undefined ? undefined : Number(opts.get("--budget"));
          const base = {
            hostId: m.id,
            sessionId,
            ...(to === undefined ? {} : { targetHostId: to.id }),
            ...(opts.get("--project") === undefined ? {} : { projectId: opts.get("--project")! }),
            ...(budget === undefined ? {} : { budget }),
          };
          if (cmd === "show") {
            const p = await preview(base);
            const where = `${p.target.projectName ?? "(no project)"} on ${(all.find(x => x.id === p.target.hostId) ?? m).name} in ${p.target.path ?? "the project's source"}`;
            const out = [
              p.header,
              `Handoff: ${p.plan.tokens.toLocaleString("en-US")} tokens (full transcript ${p.plan.fullTokens.toLocaleString("en-US")}); ${p.plan.full} turns full, ${p.plan.condensed} without tool lines, ${p.plan.omitted} omitted.`,
              `Would run: ${where}.${p.environmentError === null ? "" : ` Cannot: ${p.environmentError}`}`,
              ...p.target.notes.map(n => `Note: ${n}`),
              p.imports.length > 0 ? `Imported before: ${p.imports.map(i => i.threadId).join(", ")}` : "",
              flags.has("--full") ? `\n${p.opening}\n\n…\n\n${p.ending}` : "",
            ];
            return { exitCode: 0, stdout: out.filter(x => x.length > 0).join("\n") };
          }
          const prompt = opts.get("--prompt");
          const r = await importSession({ ...base, ...(prompt === undefined ? {} : { firstMessage: prompt }) });
          return { exitCode: 0, stdout: `Thread started: ${r.threadId}\nTranscript: ${r.transcriptPath}\nHandoff: ${r.plan.tokens} tokens; ${r.plan.omitted} turns omitted.` };
        }
        default:
          return { exitCode: 2, stderr: `Unknown command ${cmd}.\n${HELP}` };
      }
    } catch (err) {
      return { exitCode: 1, stderr: err instanceof Error ? err.message : String(err) };
    }
  }

  bb.onDispose(() => {
    transcripts.clear();
    identities.clear();
  });
}

const HELP = [
  "Usage: bb session-import <command>",
  "",
  "Continue a Claude Code session that ran outside bb, from any machine bb reaches.",
  "The new thread starts on the session's machine, in its directory, with the",
  "cleaned transcript (messages, one line per tool call, no tool output).",
  "",
  "  machines                          machines bb reaches",
  "  list [--machine m] [--days N | --all] [--cwd text] [--json]",
  "                                    sessions there, newest first (default: server, 30 days)",
  "  show <id> [--machine m] [--to m] [--project id] [--budget N] [--full]",
  "                                    what an import would send and where it would run",
  "  import <id> [--machine m] [--to m] [--project id] [--prompt text] [--budget N]",
  "                                    start the thread; --to runs it on another machine",
].join("\n");

export type { SessionSummary };
