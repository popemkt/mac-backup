// The Codex voice backend: realtime voice on a ChatGPT login, through `codex app-server` (host.ts) on a bb machine
// resolved from bb (core/hosts.ts). Codex's realtime model talks; its backing Codex thread (the concierge) does the
// work with the bb CLI and its answers are spoken back.
import type { CodexHomeMode, ProbeResult, VoiceEvent } from "../contract.ts";
import type { BackendStatus, LoginChallenge, StartOptions, VoiceBackend, VoiceSession } from "./backend.ts";
import { candidates, pick, type Machine, type Probe } from "./hosts.ts";
import { agentInstructions, voicePrompt } from "./persona.ts";

export interface CodexHostApi {
  probe(hostId: string, input: { codexHome: CodexHomeMode }): Promise<ProbeResult>;
  loginStart(hostId: string, input: { codexHome: CodexHomeMode }): Promise<{ verificationUrl: string; userCode: string }>;
  logout(hostId: string, input: { codexHome: CodexHomeMode }): Promise<unknown>;
  start(
    hostId: string,
    input: {
      codexHome: CodexHomeMode;
      threadId: string | null;
      sdp: string;
      voice: string | null;
      version: "v1" | "v3";
      voicePrompt: string;
      agentInstructions: string;
      relay: boolean;
    },
  ): Promise<{ threadId: string; sdp: string }>;
  sendText(hostId: string, input: { threadId: string; text: string }): Promise<unknown>;
  stop(hostId: string, input: { threadId: string }): Promise<unknown>;
}

export interface CodexBackendDeps {
  host: CodexHostApi;
  machines(): Promise<Machine[]>;
  settings(): Promise<{ machine: string; codexHome: CodexHomeMode; version: "v1" | "v3" }>;
  /** The concierge's Codex thread per machine and Codex home, kept across calls so the conversation continues. */
  threads: { get(key: string): Promise<string | null>; set(key: string, threadId: string): Promise<void> };
}

const PROBE_TTL_MS = 60_000;
const ready = (r: ProbeResult) => r.authType === "chatgpt";
const usable = (r: ProbeResult) => r.codexPath !== null;

export class CodexBackend implements VoiceBackend {
  readonly id = "codex";
  readonly label = "Codex (ChatGPT plan)";
  private cached: { at: number; key: string; probe: Probe<ProbeResult> | null } | null = null;
  /** Live conversation (Codex thread id) → the machine it runs on. */
  private readonly live = new Map<string, string>();
  private readonly listeners = new Set<(conversationId: string | null, event: VoiceEvent) => void>();

  private readonly deps: CodexBackendDeps;

  constructor(deps: CodexBackendDeps) {
    this.deps = deps;
  }

  /** Feed host signals in (server.ts subscribes to the host entry and calls this). */
  receive(threadId: string | null, event: VoiceEvent): void {
    if (event.kind === "closed" && threadId !== null) this.live.delete(threadId);
    if (event.kind === "login") this.cached = null;
    for (const l of this.listeners) l(threadId, event);
  }

  onEvent(listener: (conversationId: string | null, event: VoiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The machine to use, probing candidates in order until one is ready (cached for a minute). */
  async resolve(force = false): Promise<Probe<ProbeResult> | null> {
    const s = await this.deps.settings();
    const key = `${s.machine}|${s.codexHome}`;
    if (!force && this.cached !== null && this.cached.key === key && Date.now() - this.cached.at < PROBE_TTL_MS) return this.cached.probe;
    const probes: Probe<ProbeResult>[] = [];
    for (const machine of candidates(await this.deps.machines(), s.machine)) {
      let result: ProbeResult;
      try {
        result = await this.deps.host.probe(machine.id, { codexHome: s.codexHome });
      } catch (e) {
        result = { codexPath: null, codexVersion: null, authType: null, account: null, bbPath: null, message: e instanceof Error ? e.message : String(e) };
      }
      probes.push({ machine, result });
      if (ready(result)) break;
    }
    const probe = pick(probes, ready, usable);
    this.cached = { at: Date.now(), key, probe };
    return probe;
  }

  async status(): Promise<BackendStatus> {
    const s = await this.deps.settings();
    const p = await this.resolve(true);
    if (p === null) {
      const message = s.machine === "" ? "No connected bb machine" : `No bb machine named ${s.machine}`;
      return { ready: false, needsLogin: false, where: null, account: null, message, details: { codexHome: s.codexHome } };
    }
    const r = p.result;
    return {
      ready: ready(r),
      needsLogin: !ready(r) && usable(r),
      where: p.machine.name,
      account: r.account,
      message: r.message,
      details: { codexHome: s.codexHome, codex: r.codexPath, codexVersion: r.codexVersion, bb: r.bbPath, version: s.version },
    };
  }

  async login(): Promise<LoginChallenge> {
    const s = await this.deps.settings();
    const p = await this.resolve(true);
    if (p === null || p.result.codexPath === null) throw new Error("No bb machine with a Codex CLI to sign in on");
    const r = await this.deps.host.loginStart(p.machine.id, { codexHome: s.codexHome });
    return { url: r.verificationUrl, code: r.userCode };
  }

  async logout(): Promise<void> {
    const s = await this.deps.settings();
    const p = await this.resolve(true);
    if (p !== null) await this.deps.host.logout(p.machine.id, { codexHome: s.codexHome });
    this.cached = null;
  }

  async start(options: StartOptions): Promise<VoiceSession> {
    const s = await this.deps.settings();
    const p = await this.resolve();
    if (p === null || !ready(p.result)) throw new Error(p === null ? "No bb machine for the voice concierge" : `${p.machine.name}: ${p.result.message}`);
    const ctx = { machine: p.machine.name, hasBbCli: p.result.bbPath !== null, extra: options.extra.trim(), relay: options.relay };
    const key = `${p.machine.id}|${s.codexHome}`;
    const r = await this.deps.host.start(p.machine.id, {
      codexHome: s.codexHome,
      threadId: options.relay ? null : await this.deps.threads.get(key),
      sdp: options.offer.sdp,
      voice: options.voice,
      version: s.version,
      voicePrompt: voicePrompt(ctx),
      agentInstructions: agentInstructions(ctx),
      relay: options.relay,
    });
    if (!options.relay) await this.deps.threads.set(key, r.threadId);
    this.live.set(r.threadId, p.machine.id);
    return { conversationId: r.threadId, answer: { kind: "webrtc", sdp: r.sdp } };
  }

  async sendText(conversationId: string, text: string): Promise<void> {
    const hostId = this.live.get(conversationId);
    if (hostId === undefined) throw new Error("That voice call is not live");
    await this.deps.host.sendText(hostId, { threadId: conversationId, text });
  }

  async stop(conversationId: string): Promise<void> {
    const hostId = this.live.get(conversationId);
    if (hostId === undefined) return;
    this.live.delete(conversationId);
    await this.deps.host.stop(hostId, { threadId: conversationId });
  }
}
