// bb-plugin-voice-concierge — the backend. Picks the voice backend (core/backend.ts; Codex is the first), owns the
// concierge's own bb thread (core/concierge-thread.ts) that a call relays to, answers the page's RPC (status, sign-in,
// start/stop a call, typed input, the thread), keeps a log of what was said in calls in the plugin's own storage, and
// serves `bb voice-concierge` (including `ask`, the relay).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { codexHomeMode, hostContract, hostSignals, type VoiceEvent } from "./contract.ts";
import type { BackendStatus, VoiceBackend } from "./core/backend.ts";
import { CodexBackend } from "./core/codex.ts";
import { ConciergeThread } from "./core/concierge-thread.ts";
import type { Machine } from "./core/hosts.ts";
import { LIVE_CHANNEL, STYLE_CHANNEL } from "./core/live.ts";
import { isSphereStyle, SPHERE_STYLES, STYLE_LABELS, type SphereStyle } from "./core/sphere-styles.ts";
import { appendLine, type TranscriptLine } from "./core/transcript.ts";

const TRANSCRIPT_KEY = "transcript";
const THREAD_KEY = "conciergeThread";

const status = z.object({
  backend: z.string(),
  ready: z.boolean(),
  needsLogin: z.boolean(),
  where: z.string().nullable(),
  account: z.string().nullable(),
  message: z.string(),
  details: z.record(z.string(), z.string().nullable()),
});
const line = z.object({ at: z.number(), role: z.string(), text: z.string() });

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: status },
  login: { input: z.null(), output: z.object({ url: z.string(), code: z.string() }) },
  logout: { input: z.null(), output: z.object({ ok: z.boolean() }) },
  start: { input: z.object({ sdp: z.string().min(1) }), output: z.object({ conversationId: z.string(), sdp: z.string() }) },
  sendText: { input: z.object({ conversationId: z.string(), text: z.string().min(1).max(4000) }), output: z.object({ ok: z.boolean() }) },
  stop: { input: z.object({ conversationId: z.string() }), output: z.object({ ok: z.boolean() }) },
  transcript: { input: z.object({ limit: z.number().int().min(1).max(500).optional() }), output: z.object({ lines: z.array(line) }) },
  clearTranscript: { input: z.null(), output: z.object({ ok: z.boolean() }) },
  /** The sphere's art style (the plugin setting); setStyle is the page's quick switcher. */
  style: { input: z.null(), output: z.object({ style: z.string() }) },
  setStyle: { input: z.object({ style: z.string() }), output: z.object({ style: z.string() }) },
  /** The concierge's own bb thread, if it has one. */
  thread: { input: z.null(), output: z.object({ threadId: z.string().nullable() }) },
});

export type LiveSignal = { conversationId: string | null; event: VoiceEvent };

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    backend: {
      type: "select",
      label: "Voice backend",
      options: ["codex"],
      experimental_optionLabels: { codex: "Codex realtime (ChatGPT plan)" },
      default: "codex",
    },
    machine: {
      type: "string",
      label: "Machine (name or id; empty = the bb server's machine, else any connected machine where Codex is signed in)",
      default: "",
    },
    codexHome: {
      type: "select",
      label: "Codex login",
      options: ["dedicated", "user"],
      experimental_optionLabels: { dedicated: "The plugin's own Codex login (default)", user: "That machine's ~/.codex" },
      default: "dedicated",
    },
    version: {
      type: "select",
      label: "Realtime model",
      options: ["v3", "v1"],
      experimental_optionLabels: { v3: "GPT-Live (v3)", v1: "gpt-realtime (v1)" },
      default: "v3",
    },
    voice: { type: "string", label: "Voice (empty = the model's default; see the page for names)", default: "" },
    sphereStyle: {
      type: "select",
      label: "Sphere art style",
      options: [...SPHERE_STYLES],
      experimental_optionLabels: STYLE_LABELS,
      default: "jelly",
    },
    threadProvider: { type: "string", label: "Agent provider for the concierge's thread (empty = the project's default)", default: "" },
    threadModel: { type: "string", label: "Model for the concierge's thread (empty = the provider's default)", default: "" },
    instructions: {
      type: "string",
      label: "Extra instructions for the concierge",
      experimental_multiline: true,
      experimental_schema: z.string().max(4000),
      default: "",
    },
  });

  const styleOf = (s: string): SphereStyle => (isSphereStyle(s) ? s : "jelly");
  settings.onChange((next, prev) => {
    if (next.sphereStyle !== prev.sphereStyle) bb.realtime.publish(STYLE_CHANNEL, { style: styleOf(next.sphereStyle) });
  });

  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  const call =
    <M extends keyof typeof hostContract & string>(method: M, timeoutMs?: number) =>
    (hostId: string, input: z.input<(typeof hostContract)[M]["input"]>) =>
      host.call(method, input as never, { hostId, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

  async function machines(): Promise<Machine[]> {
    const [hosts, config] = await Promise.all([bb.sdk.hosts.list(), bb.sdk.system.config().catch(() => null)]);
    return hosts
      .filter(h => h.lifecycle.phase === "active")
      .map(h => ({ id: h.id, name: h.name, connected: h.status === "connected", isServer: h.id === config?.primaryHostId }));
  }

  const codex = new CodexBackend({
    host: {
      probe: call("probe", 60_000),
      loginStart: call("loginStart", 60_000),
      logout: call("logout"),
      start: call("start", 90_000),
      sendText: call("sendText"),
      stop: call("stop"),
    },
    machines,
    settings: async () => {
      const s = await settings.get();
      return { machine: s.machine, codexHome: codexHomeMode.parse(s.codexHome), version: s.version === "v1" ? "v1" : "v3" };
    },
    threads: {
      get: async key => (await bb.storage.kv.get<string>(`thread/${key}`)) ?? null,
      set: (key, threadId) => bb.storage.kv.set(`thread/${key}`, threadId),
    },
  });
  host.experimental_onSignal("event", ({ payload }) => codex.receive(payload.threadId, payload.event));

  const backends: Record<string, VoiceBackend> = { codex };

  // ---------------------------------------------------------------- the concierge's own bb thread
  const concierge = new ConciergeThread({
    threads: {
      status: async threadId => {
        try {
          const t = await bb.sdk.threads.get({ threadId });
          return t.archivedAt === null ? t.status : null;
        } catch {
          return null; // deleted
        }
      },
      spawn: async ({ projectId, hostId, brief }) => {
        const s = await settings.get();
        const t = await bb.sdk.threads.spawn({
          projectId,
          environment: hostId === null ? { type: "project-default" } : { type: "host", hostId, workspace: { type: "personal" } },
          title: "Voice concierge",
          prompt: brief,
          pinned: true,
          pluginMetadata: { role: "concierge" },
          ...(s.threadProvider.trim() === "" ? {} : { providerId: s.threadProvider.trim() }),
          ...(s.threadModel.trim() === "" ? {} : { model: s.threadModel.trim() }),
        });
        return t.id;
      },
      send: async (threadId, text) => {
        await bb.sdk.threads.send({ threadId, input: [{ type: "text", text, mentions: [] }], mode: "queue-if-active" });
      },
      output: async threadId => (await bb.sdk.threads.output({ threadId })).output,
    },
    store: { get: async () => (await bb.storage.kv.get<string>(THREAD_KEY)) ?? null, set: id => bb.storage.kv.set(THREAD_KEY, id) },
  });
  /**
   * The thread, created on first use (and again if it was archived or deleted) in bb's Personal project, in a personal
   * workspace on the concierge's machine; null only when bb has no Personal project.
   */
  async function conciergeThread(): Promise<string | null> {
    const id = await concierge.current();
    if (id !== null) return id;
    const personal = (await bb.sdk.projects.list({ includePersonal: true })).find(p => p.kind === "personal");
    if (personal === undefined) return null;
    return concierge.ensure(personal.id, (await codex.resolve())?.machine.id ?? null);
  }
  async function backend(): Promise<VoiceBackend> {
    const id = (await settings.get()).backend;
    const b = backends[id];
    if (b === undefined) throw new Error(`Unknown voice backend ${id}`);
    return b;
  }

  // ---------------------------------------------------------------- the conversation's own record
  let writing: Promise<unknown> = Promise.resolve();
  function record(role: string, text: string): void {
    writing = writing.then(async () => {
      const lines = (await bb.storage.kv.get<TranscriptLine[]>(TRANSCRIPT_KEY)) ?? [];
      await bb.storage.kv.set(TRANSCRIPT_KEY, appendLine(lines, { at: Date.now(), role, text }));
    }).catch(e => bb.log.warn(`voice-concierge: transcript write failed: ${String(e)}`));
  }
  for (const b of Object.values(backends)) {
    b.onEvent((conversationId, event) => {
      if (event.kind === "transcript" && event.final && event.text.trim() !== "") record(event.role, event.text.trim());
      if (event.kind === "error") record("system", `Error: ${event.message}`);
      if (event.kind === "closed") record("system", `Call ended${event.reason === null ? "" : ` (${event.reason})`}`);
      bb.realtime.publish(LIVE_CHANNEL, { conversationId, event } satisfies LiveSignal);
    });
  }

  async function statusOf(): Promise<z.infer<typeof status>> {
    const b = await backend();
    const s: BackendStatus = await b.status();
    return { backend: b.id, ...s };
  }

  bb.rpc.register(rpcContract, {
    status: () => statusOf(),
    login: async () => {
      const b = await backend();
      if (b.login === undefined) throw new Error(`${b.label} has no interactive sign-in`);
      return b.login();
    },
    logout: async () => {
      await (await backend()).logout?.();
      return { ok: true };
    },
    start: async ({ sdp }) => {
      const s = await settings.get();
      const relay = (await conciergeThread().catch(() => null)) !== null;
      const session = await (await backend()).start({ offer: { kind: "webrtc", sdp }, voice: s.voice.trim() === "" ? null : s.voice.trim(), extra: s.instructions, relay });
      record("system", "Call started");
      return { conversationId: session.conversationId, sdp: session.answer.sdp };
    },
    sendText: async ({ conversationId, text }) => {
      await (await backend()).sendText(conversationId, text);
      record("user", `(typed) ${text}`);
      return { ok: true };
    },
    stop: async ({ conversationId }) => {
      await (await backend()).stop(conversationId);
      return { ok: true };
    },
    transcript: async ({ limit }) => {
      const lines = (await bb.storage.kv.get<TranscriptLine[]>(TRANSCRIPT_KEY)) ?? [];
      return { lines: lines.slice(-(limit ?? 200)) };
    },
    clearTranscript: async () => {
      await bb.storage.kv.delete(TRANSCRIPT_KEY);
      return { ok: true };
    },
    thread: async () => ({ threadId: await conciergeThread() }),
    style: async () => ({ style: styleOf((await settings.get()).sphereStyle) }),
    setStyle: async ({ style }) => {
      if (!isSphereStyle(style)) throw new Error(`Unknown sphere style ${style}`);
      await settings.experimental_set({ sphereStyle: style });
      return { style };
    },
  });

  // ---------------------------------------------------------------- CLI
  const HELP = `bb voice-concierge — talk to bb out loud (open the Voice concierge page in bb to start a call)

  status          where the voice backend runs, its login, and whether it is ready
  login           sign the backend in (prints a URL and a one-time code)
  logout          sign the backend out
  transcript [N]  the last N lines said in calls (default 30)
  thread          the concierge's own bb thread
  ask <request>   send a request to the concierge's thread and print its reply (the call's relay)`;

  bb.cli.register({
    name: "voice-concierge",
    summary: "Talk to bb out loud: status, sign-in and transcript of the voice concierge.",
    commands: [
      { name: "status", summary: "Backend, machine, login, readiness", usage: "bb voice-concierge status [--json]" },
      { name: "login", summary: "Sign the voice backend in (device code)", usage: "bb voice-concierge login" },
      { name: "logout", summary: "Sign the voice backend out", usage: "bb voice-concierge logout" },
      { name: "transcript", summary: "What was said in calls", usage: "bb voice-concierge transcript [N]" },
      { name: "thread", summary: "The concierge's own bb thread", usage: "bb voice-concierge thread" },
      { name: "ask", summary: "Ask the concierge's thread and print its reply", usage: "bb voice-concierge ask '<request>'" },
    ],
    run: async argv => {
      const [cmd, arg] = argv;
      try {
        switch (cmd) {
          case "status": {
            const s = await statusOf();
            if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(s, null, 2) };
            const details = Object.entries(s.details).map(([k, v]) => `  ${k}: ${v ?? "—"}`);
            return {
              exitCode: s.ready ? 0 : 1,
              stdout: [`backend: ${s.backend}`, `machine: ${s.where ?? "—"}`, `account: ${s.account ?? "—"}`, `ready:   ${s.ready ? "yes" : `no — ${s.message}`}`, ...details].join("\n"),
            };
          }
          case "login": {
            const b = await backend();
            if (b.login === undefined) return { exitCode: 1, stderr: `${b.label} has no interactive sign-in` };
            const c = await b.login();
            return { exitCode: 0, stdout: `Open ${c.url} and enter the code ${c.code} (valid for about 15 minutes).` };
          }
          case "logout":
            await (await backend()).logout?.();
            return { exitCode: 0, stdout: "Signed out." };
          case "transcript": {
            const n = Math.min(500, Math.max(1, Number(arg ?? 30) || 30));
            const lines = ((await bb.storage.kv.get<TranscriptLine[]>(TRANSCRIPT_KEY)) ?? []).slice(-n);
            return { exitCode: 0, stdout: lines.map(l => `${new Date(l.at).toISOString().slice(11, 19)} ${l.role}: ${l.text}`).join("\n") || "(empty)" };
          }
          case "thread": {
            const id = await conciergeThread();
            return id === null ? { exitCode: 1, stderr: "bb has no Personal project for the concierge's thread." } : { exitCode: 0, stdout: id };
          }
          case "ask": {
            const text = argv.slice(1).join(" ").trim();
            if (text === "") return { exitCode: 2, stderr: "usage: bb voice-concierge ask '<request>'" };
            if ((await conciergeThread()) === null) return { exitCode: 1, stderr: "bb has no Personal project for the concierge's thread." };
            return { exitCode: 0, stdout: await concierge.ask(text) };
          }
          default:
            return { exitCode: cmd === undefined || cmd === "help" || cmd === "--help" || cmd === "-h" ? 0 : 2, stdout: HELP };
        }
      } catch (e) {
        return { exitCode: 1, stderr: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}
