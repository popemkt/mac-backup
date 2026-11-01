// bb-plugin-voice-concierge — the host entry. Runs in the bb host daemon of the machine the server picked for the
// Codex backend. It owns one `codex app-server` per Codex home, keeps the concierge's Codex thread, and starts realtime
// voice on it over WebRTC: the client's SDP offer goes in, the answer comes back, and audio then flows between the
// client and OpenAI directly. Codex authenticates the call with its own ChatGPT login; this file never sees a token.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, hostSignals, type CodexHomeMode, type ProbeResult, type VoiceEvent } from "./contract.ts";
import { JsonRpcPeer } from "./core/jsonrpc.ts";
import { activityFromItem, transcriptRole } from "./core/codex-events.ts";
import { answerToolCall, ASK_TOOL_SPEC } from "./core/relay-tool.ts";

/** Where macOS installs keep the Codex CLI when it is not on PATH. */
const CODEX_FALLBACKS = [
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "/Applications/Codex.app/Contents/Resources/codex",
];
/** bb's account-pool routing points Codex at a hub without realtime calls; the concierge talks to OpenAI directly. */
const STRIPPED_ENV = ["CODEX_OPENAI_BASE_URL", "CODEX_POOL_AUTH_TOKEN", "CODEX_HOME"];
const SDP_TIMEOUT_MS = 45_000;
const ASK_TIMEOUT_MS = 150_000;

/** Ask the concierge's bb thread through the bb CLI on this machine and return its reply. */
async function askConcierge(request: string): Promise<string> {
  const bb = await which("bb");
  if (bb === null) throw new Error("no bb CLI on this machine");
  return new Promise((resolve, reject) => {
    execFile(bb, ["voice-concierge", "ask", request], { timeout: ASK_TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, stdout, stderr) =>
      err === null ? resolve(stdout) : reject(new Error(stderr.trim() || err.message)),
    );
  });
}

type Emit = (threadId: string | null, event: VoiceEvent) => void;
type Lease = { dispose(): void };

function which(cmd: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile("sh", ["-c", `command -v ${cmd}`], { timeout: 5_000 }, (err, stdout) => resolve(err === null && stdout.trim() !== "" ? stdout.trim() : null));
  });
}

async function codexBinary(): Promise<string | null> {
  return (await which("codex")) ?? CODEX_FALLBACKS.find(p => existsSync(p)) ?? null;
}

function version(bin: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile(bin, ["--version"], { timeout: 10_000 }, (err, stdout) => resolve(err === null ? stdout.trim() : null));
  });
}

/** One running `codex app-server` and what it is doing. */
class AppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  readonly rpc: JsonRpcPeer;
  private readonly sdpWaiters = new Map<string, { resolve: (sdp: string) => void; reject: (e: Error) => void }>();
  /** Concierge threads with a live realtime session, and the lease that keeps this worker up for each. */
  readonly live = new Map<string, Lease>();
  readonly ready: Promise<void>;

  readonly codexHome: string | null;
  private readonly emit: Emit;

  constructor(bin: string, codexHome: string | null, emit: Emit) {
    this.codexHome = codexHome;
    this.emit = emit;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of STRIPPED_ENV) delete env[k];
    if (codexHome !== null) env.CODEX_HOME = codexHome;
    // The concierge's shell runs `bb` against the bb server: it needs the network, nothing else outside its workspace.
    this.child = spawn(bin, ["app-server", "-c", "sandbox_workspace_write.network_access=true"], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.resume();
    this.rpc = new JsonRpcPeer(this.child.stdout, this.child.stdin, {
      notification: (method, params) => this.onNotification(method, params as Record<string, unknown>),
      request: (method, params) => {
        // The relay's one tool: answered when the concierge's bb thread replies, however long that takes.
        if (method === "item/tool/call") return answerToolCall(params, askConcierge);
        // The concierge runs with approvals off; anything else asking is declined rather than left hanging.
        if (method.endsWith("requestApproval")) return { decision: "decline" };
        throw new Error(`voice-concierge does not answer ${method}`);
      },
    });
    this.child.on("exit", code => {
      const error = new Error(`codex app-server exited (${code ?? "signal"})`);
      this.rpc.fail(error);
      for (const w of this.sdpWaiters.values()) w.reject(error);
      for (const [threadId, lease] of this.live) {
        lease.dispose();
        this.emit(threadId, { kind: "closed", reason: "codex app-server exited" });
      }
      this.live.clear();
    });
    this.ready = this.rpc
      .request("initialize", { clientInfo: { name: "bb-voice-concierge", title: "bb Voice Concierge", version: "0.1.0" }, capabilities: { experimentalApi: true } })
      .then(() => this.rpc.notify("initialized"));
  }

  get exited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null || this.rpc.isClosed;
  }

  kill(): void {
    if (!this.exited) this.child.kill("SIGTERM");
  }

  waitForSdp(threadId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.sdpWaiters.delete(threadId);
        reject(new Error("Codex did not answer the voice call in time"));
      }, SDP_TIMEOUT_MS);
      this.sdpWaiters.set(threadId, {
        resolve: sdp => (clearTimeout(timer), resolve(sdp)),
        reject: e => (clearTimeout(timer), reject(e)),
      });
    });
  }

  release(threadId: string, reason: string | null): void {
    const lease = this.live.get(threadId);
    if (lease === undefined) return;
    this.live.delete(threadId);
    lease.dispose();
    this.emit(threadId, { kind: "closed", reason });
  }

  private onNotification(method: string, p: Record<string, unknown>): void {
    const threadId = typeof p?.threadId === "string" ? p.threadId : null;
    switch (method) {
      case "thread/realtime/sdp": {
        const w = threadId === null ? undefined : this.sdpWaiters.get(threadId);
        if (w !== undefined && typeof p.sdp === "string") {
          this.sdpWaiters.delete(threadId!);
          w.resolve(p.sdp);
        }
        return;
      }
      case "thread/realtime/error": {
        const message = String(p.message ?? "realtime error");
        const w = threadId === null ? undefined : this.sdpWaiters.get(threadId);
        if (w !== undefined) {
          this.sdpWaiters.delete(threadId!);
          w.reject(new Error(message));
        }
        this.emit(threadId, { kind: "error", message });
        return;
      }
      case "thread/realtime/closed":
        if (threadId !== null) this.release(threadId, typeof p.reason === "string" ? p.reason : null);
        return;
      case "thread/realtime/transcript/delta":
        if (typeof p.delta === "string") this.emit(threadId, { kind: "transcript", role: transcriptRole(p.role), text: p.delta, final: false });
        return;
      case "thread/realtime/transcript/done":
        if (typeof p.text === "string") this.emit(threadId, { kind: "transcript", role: transcriptRole(p.role), text: p.text, final: true });
        return;
      case "turn/started":
        if (threadId !== null && this.live.has(threadId)) this.emit(threadId, { kind: "activity", state: "working", detail: null });
        return;
      case "turn/completed":
        if (threadId !== null && this.live.has(threadId)) this.emit(threadId, { kind: "activity", state: "idle", detail: null });
        return;
      case "item/started": {
        const detail = threadId !== null && this.live.has(threadId) ? activityFromItem(p.item) : null;
        if (detail !== null) this.emit(threadId, { kind: "activity", state: "working", detail });
        return;
      }
      case "account/login/completed":
        this.emit(null, { kind: "login", success: p.success === true, error: typeof p.error === "string" ? p.error : null });
        return;
    }
  }
}

const servers = new Map<CodexHomeMode, AppServer>();
let emitter: Emit = () => {};

async function homeDir(mode: CodexHomeMode, dataDir: string): Promise<string | null> {
  if (mode === "user") return null;
  const dir = join(dataDir, "codex-home");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

async function server(mode: CodexHomeMode, dataDir: string): Promise<AppServer> {
  const existing = servers.get(mode);
  if (existing !== undefined && !existing.exited) return existing;
  const bin = await codexBinary();
  if (bin === null) throw new Error("No Codex CLI on this machine (install it, or pick another machine in the plugin settings)");
  const s = new AppServer(bin, await homeDir(mode, dataDir), (t, e) => emitter(t, e));
  servers.set(mode, s);
  await s.ready;
  return s;
}

function accountLabel(result: unknown): { authType: string | null; account: string | null } {
  const account = (result as { account?: { type?: string; email?: string; planType?: string } | null })?.account;
  if (account === undefined || account === null) return { authType: null, account: null };
  const plan = account.planType === undefined ? "" : ` (${account.planType})`;
  return { authType: account.type ?? null, account: account.email === undefined ? `${account.type ?? "account"}${plan}` : `${account.email}${plan}` };
}

async function probe(mode: CodexHomeMode, dataDir: string): Promise<ProbeResult> {
  const [codexPath, bbPath] = await Promise.all([codexBinary(), which("bb")]);
  if (codexPath === null) return { codexPath, codexVersion: null, authType: null, account: null, bbPath, message: "No Codex CLI on this machine" };
  const codexVersion = await version(codexPath);
  try {
    const s = await server(mode, dataDir);
    const { authType, account } = accountLabel(await s.rpc.request("account/read", { refreshToken: false }));
    const message =
      authType === null ? "Codex is signed out here: sign in with ChatGPT" : authType !== "chatgpt" ? `Codex uses ${authType} auth here; voice needs a ChatGPT login` : "ready";
    return { codexPath, codexVersion, authType, account, bbPath, message };
  } catch (e) {
    return { codexPath, codexVersion, authType: null, account: null, bbPath, message: e instanceof Error ? e.message : String(e) };
  }
}

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    probe: ({ codexHome }, ctx) => probe(codexHome, ctx.experimental_paths.dataDir),
    loginStart: async ({ codexHome }, ctx) => {
      emitter = (threadId, event) => void ctx.experimental_emitSignal("event", { threadId, event }).catch(() => {});
      const s = await server(codexHome, ctx.experimental_paths.dataDir);
      const r = await s.rpc.request<{ type: string; loginId?: string; userCode?: string; verificationUrl?: string }>("account/login/start", { type: "chatgptDeviceCode" });
      if (r.userCode === undefined || r.verificationUrl === undefined || r.loginId === undefined) throw new Error(`Codex did not offer a device code (got ${r.type})`);
      // Keep the worker (and its app-server) up until the login completes or times out.
      const lease = ctx.experimental_retainWorker();
      setTimeout(() => lease.dispose(), 15 * 60_000).unref();
      return { verificationUrl: r.verificationUrl, userCode: r.userCode, loginId: r.loginId };
    },
    logout: async ({ codexHome }, ctx) => {
      const s = await server(codexHome, ctx.experimental_paths.dataDir);
      await s.rpc.request("account/logout", undefined);
      return { ok: true };
    },
    start: async (input, ctx) => {
      emitter = (threadId, event) => void ctx.experimental_emitSignal("event", { threadId, event }).catch(() => {});
      const dataDir = ctx.experimental_paths.dataDir;
      const s = await server(input.codexHome, dataDir);
      const workspace = join(dataDir, "workspace");
      await mkdir(workspace, { recursive: true });
      const threadOptions = {
        cwd: workspace,
        sandbox: "workspace-write",
        approvalPolicy: "never",
        developerInstructions: input.agentInstructions,
      };
      // Relaying, the backing thread is a fresh, ephemeral one per call with the one tool: the conversation lives in
      // the concierge's bb thread.
      let threadId = input.relay ? null : input.threadId;
      if (threadId !== null) {
        try {
          await s.rpc.request("thread/resume", { threadId, ...threadOptions });
        } catch {
          threadId = null;
        }
      }
      if (threadId === null) {
        const r = await s.rpc.request<{ thread: { id: string } }>(
          "thread/start",
          input.relay ? { ...threadOptions, ephemeral: true, dynamicTools: [ASK_TOOL_SPEC] } : { ...threadOptions, ephemeral: false },
        );
        threadId = r.thread.id;
        if (!input.relay) await s.rpc.request("thread/name/set", { threadId, name: "Voice concierge" }).catch(() => {});
      }
      if (s.live.has(threadId)) s.release(threadId, "replaced by a new call");
      const answer = s.waitForSdp(threadId);
      s.live.set(threadId, ctx.experimental_retainWorker());
      try {
        await s.rpc.request("thread/realtime/start", {
          threadId,
          outputModality: "audio",
          transport: { type: "webrtc", sdp: input.sdp },
          version: input.version,
          ...(input.voice === null ? {} : { voice: input.voice }),
          prompt: input.voicePrompt,
        });
        return { threadId, sdp: await answer };
      } catch (e) {
        s.release(threadId, null);
        throw e;
      }
    },
    sendText: async ({ threadId, text }) => {
      const s = [...servers.values()].find(x => x.live.has(threadId));
      if (s === undefined) throw new Error("No live voice session on that thread");
      await s.rpc.request("thread/realtime/appendText", { threadId, text });
      return { ok: true };
    },
    stop: async ({ threadId }) => {
      const s = [...servers.values()].find(x => x.live.has(threadId));
      if (s === undefined) return { ok: true };
      await s.rpc.request("thread/realtime/stop", { threadId }).catch(() => {});
      s.release(threadId, "stopped");
      return { ok: true };
    },
  },
  dispose: () => {
    for (const s of servers.values()) s.kill();
    servers.clear();
  },
});
