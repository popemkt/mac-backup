// bb-plugin-voice-concierge — the frontend. The call itself (microphone, WebRTC peer, speaker) lives in a module-level
// CallManager so it survives moving around bb; the "Voice concierge" page starts and ends calls and shows the
// conversation, and an app overlay keeps a small live pill (mute, hang up) on every page while a call is up.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { definePluginApp, ThreadChat, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { LiveSignal, rpcContract } from "./server.ts";
import { LIVE_CHANNEL, STYLE_CHANNEL } from "./core/live.ts";
import { isSphereStyle, SPHERE_STYLES, STYLE_LABELS, type SphereStyle } from "./core/sphere-styles.ts";
import { Sphere, type SphereLook, type SphereMode } from "./sphere.ts";

const PAGE = "concierge";
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Phase = "idle" | "connecting" | "live" | "ending";
interface CallState {
  phase: Phase;
  conversationId: string | null;
  muted: boolean;
  error: string | null;
  /** The current partial caption, per speaker. */
  caption: { role: string; text: string } | null;
  /** What the concierge's agent is doing right now, if anything. */
  activity: string | null;
  /** Bumped on every final line, so the page refetches the transcript. */
  revision: number;
}

/** One call at a time, for the whole app. */
class CallManager {
  private state: CallState = { phase: "idle", conversationId: null, muted: false, error: null, caption: null, activity: null, revision: 0 };
  private readonly listeners = new Set<() => void>();
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private speaker: HTMLAudioElement | null = null;
  private rpc: Rpc | null = null;
  /** Loudness meters on the microphone and the concierge's voice, for the sphere. */
  private audio: AudioContext | null = null;
  private meters: { mic: Meter | null; remote: Meter | null } = { mic: null, remote: null };

  subscribe = (l: () => void) => (this.listeners.add(l), () => void this.listeners.delete(l));
  snapshot = () => this.state;
  private set(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async start(rpc: Rpc): Promise<void> {
    if (this.state.phase !== "idle") return;
    this.rpc = rpc;
    this.set({ phase: "connecting", error: null, caption: null, activity: null });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This page cannot use the microphone (it needs https or localhost, and microphone permission)");
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const pc = new RTCPeerConnection();
      this.pc = pc;
      for (const track of this.mic.getAudioTracks()) pc.addTrack(track, this.mic);
      this.meters.mic = this.meter(this.mic);
      // The realtime events channel Codex's call expects next to the audio.
      pc.createDataChannel("oai-events");
      this.speaker ??= Object.assign(document.createElement("audio"), { autoplay: true });
      pc.ontrack = e => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        if (this.speaker !== null) this.speaker.srcObject = stream;
        this.meters.remote?.close();
        this.meters.remote = this.meter(stream);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") void this.stop("The voice connection failed");
      };
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc, 2_000);
      const { conversationId, sdp } = await rpc.call("start", { sdp: pc.localDescription?.sdp ?? "" });
      if (this.pc !== pc) return; // hung up while connecting
      await pc.setRemoteDescription({ type: "answer", sdp });
      this.set({ phase: "live", conversationId, muted: false });
    } catch (e) {
      this.teardown();
      this.set({ phase: "idle", error: message(e) });
    }
  }

  async stop(error: string | null = null): Promise<void> {
    const id = this.state.conversationId;
    this.set({ phase: "ending" });
    this.teardown();
    if (id !== null && this.rpc !== null) await this.rpc.call("stop", { conversationId: id }).catch(() => {});
    this.set({ phase: "idle", conversationId: null, caption: null, activity: null, error });
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = !muted;
    this.set({ muted });
  }

  receive(signal: LiveSignal): void {
    const { event } = signal;
    if (this.state.conversationId !== null && signal.conversationId !== null && signal.conversationId !== this.state.conversationId) return;
    switch (event.kind) {
      case "transcript":
        if (event.final) this.set({ caption: null, revision: this.state.revision + 1 });
        else {
          const prev = this.state.caption;
          this.set({ caption: { role: event.role, text: prev !== null && prev.role === event.role ? prev.text + event.text : event.text } });
        }
        return;
      case "activity":
        this.set({ activity: event.state === "working" ? (event.detail ?? "working…") : null });
        return;
      case "error":
        this.set({ error: event.message, revision: this.state.revision + 1 });
        return;
      case "closed":
        if (this.state.phase === "live" || this.state.phase === "connecting") {
          this.teardown();
          this.set({ phase: "idle", conversationId: null, caption: null, activity: null, revision: this.state.revision + 1 });
        }
        return;
      case "login":
        this.set({ revision: this.state.revision + 1 });
        return;
    }
  }

  /** Current loudness, 0..1, of the microphone (muted reads 0) and of the concierge's voice. */
  levels = () => ({ mic: this.state.muted ? 0 : (this.meters.mic?.level() ?? 0), remote: this.meters.remote?.level() ?? 0 });

  private meter(stream: MediaStream): Meter | null {
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
      return new Meter(this.audio, stream);
    } catch {
      return null; // no Web Audio: the sphere just does not follow the voice
    }
  }

  private teardown(): void {
    this.meters.mic?.close();
    this.meters.remote?.close();
    this.meters = { mic: null, remote: null };
    this.pc?.close();
    this.pc = null;
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
    if (this.speaker !== null) this.speaker.srcObject = null;
  }
}

/** An analyser on a stream (not connected to the speakers; the audio element plays it). */
class Meter {
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(audio: AudioContext, stream: MediaStream) {
    this.source = audio.createMediaStreamSource(stream);
    this.analyser = audio.createAnalyser();
    this.analyser.fftSize = 512;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
  }

  /** RMS of the last few milliseconds, scaled so normal speech reaches about 0.5..1. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 6);
  }

  close(): void {
    this.source.disconnect();
  }
}

function iceGathered(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(resolve => {
    const done = () => (pc.removeEventListener("icegatheringstatechange", check), resolve());
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

const calls = new CallManager();
const useCall = () => useSyncExternalStore(calls.subscribe, calls.snapshot);

// ------------------------------------------------------------------ page

interface Status {
  backend: string;
  ready: boolean;
  needsLogin: boolean;
  where: string | null;
  account: string | null;
  message: string;
  details: Record<string, string | null>;
}
function ConciergePage() {
  const rpc = useRpc<typeof rpcContract>();
  const call = useCall();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [login, setLogin] = useState<{ url: string; code: string } | null>(null);
  const [threadId, setThreadId] = useState<string | null | undefined>(undefined);

  const refreshStatus = useCallback(() => {
    setStatusError(null);
    rpc.call("status").then(setStatus, e => setStatusError(message(e)));
    rpc.call("thread").then(r => setThreadId(r.threadId), () => setThreadId(null));
  }, [rpc]);
  useEffect(refreshStatus, [refreshStatus]);
  useEffect(() => {
    if (login !== null && call.revision > 0) refreshStatus();
  }, [call.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = call.phase === "connecting" || call.phase === "ending";
  const live = call.phase === "live";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-sm">
      <div className="flex items-center gap-3">
        <div className="text-base font-medium">Voice concierge</div>
        <div className="text-xs text-muted-foreground">
          {status === null ? (statusError ?? "checking…") : `${status.backend} on ${status.where ?? "—"}${status.account === null ? "" : ` · ${status.account}`}`}
        </div>
        <button className="ml-auto text-xs text-muted-foreground underline" onClick={refreshStatus}>
          refresh
        </button>
      </div>

      {status !== null && !status.ready && (
        <div className="flex flex-col gap-2 rounded border border-border p-3">
          <div>{status.message}</div>
          {status.needsLogin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded border border-border px-3 py-1 hover:bg-muted/50"
                onClick={() => rpc.call("login").then(setLogin, e => setStatusError(message(e)))}
              >
                Sign in with ChatGPT
              </button>
              {login !== null && (
                <span>
                  Open{" "}
                  <a className="underline" href={login.url} target="_blank" rel="noreferrer">
                    {login.url}
                  </a>{" "}
                  and enter <span className="font-mono text-base font-semibold">{login.code}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <TalkingSphere />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          className={`rounded-full px-5 py-2 font-medium text-white disabled:opacity-50 ${live ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
          disabled={busy || (!live && status?.ready !== true)}
          onClick={() => (live ? void calls.stop() : void calls.start(rpc))}
        >
          {call.phase === "connecting" ? "Connecting…" : call.phase === "ending" ? "Ending…" : live ? "Hang up" : "Talk"}
        </button>
        {live && (
          <button className="rounded-full border border-border px-4 py-2 hover:bg-muted/50" onClick={() => calls.toggleMute()}>
            {call.muted ? "Unmute" : "Mute"}
          </button>
        )}
      </div>
      <div className="min-h-4 truncate text-center text-xs text-muted-foreground">
        {call.error !== null ? (
          <span className="text-destructive">{call.error}</span>
        ) : call.caption !== null ? (
          `${call.caption.role === "user" ? "You" : "Concierge"}: ${call.caption.text}`
        ) : call.activity !== null ? (
          `⋯ ${call.activity}`
        ) : (
          ""
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded border border-border">
        {threadId === undefined ? (
          <div className="p-3 text-xs text-muted-foreground">Opening the concierge's thread…</div>
        ) : threadId === null ? (
          <div className="p-3 text-xs text-muted-foreground">bb has no Personal project, so the concierge works without a thread of its own.</div>
        ) : (
          <ThreadChat threadId={threadId} variant="compact" />
        )}
      </div>
    </div>
  );
}

const LOOK_LABEL: Record<SphereLook, string> = {
  idle: "Press Talk to start",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Checking bb…",
  speaking: "Speaking",
};

function sphereMode(s: CallState): SphereMode {
  if (s.phase === "connecting") return "connecting";
  if (s.phase !== "live") return "idle";
  return s.activity !== null ? "thinking" : "live";
}

/** The sphere above the controls; it reads the call's state and voice levels itself, every frame. */
function TalkingSphere() {
  const rpc = useRpc<typeof rpcContract>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const sphere = useRef<{ sphere: Sphere; unsubscribe: () => void } | null>(null);
  const [look, setLook] = useState<SphereLook>("idle");
  const [failed, setFailed] = useState(false);
  const [style, setStyle] = useState<SphereStyle | null>(null);
  useEffect(() => {
    rpc.call("style").then(r => setStyle(isSphereStyle(r.style) ? r.style : "jelly"), () => setStyle("jelly"));
  }, [rpc]);
  useRealtime(STYLE_CHANNEL, payload => {
    const next = (payload as { style?: string }).style ?? "";
    if (isSphereStyle(next)) setStyle(next);
  });
  useEffect(() => {
    if (canvas.current === null || style === null) return;
    if (sphere.current !== null) {
      sphere.current.sphere.setStyle(style);
      return;
    }
    let s: Sphere;
    try {
      s = new Sphere(canvas.current, style, { read: () => ({ mode: sphereMode(calls.snapshot()), levels: calls.levels() }), onLook: setLook });
    } catch {
      setFailed(true); // no WebGL2: the page works without the sphere
      return;
    }
    sphere.current = { sphere: s, unsubscribe: calls.subscribe(() => s.kick()) };
  }, [style]);
  useEffect(
    () => () => {
      sphere.current?.unsubscribe();
      sphere.current?.sphere.dispose();
      sphere.current = null;
    },
    [],
  );
  const pick = (next: SphereStyle) => {
    setStyle(next);
    rpc.call("setStyle", { style: next }).catch(() => {});
  };
  return (
    <div className="flex flex-col items-center gap-1">
      {!failed && <canvas ref={canvas} className="aspect-square h-[min(36vh,300px)]" aria-hidden="true" />}
      <div className="text-xs text-muted-foreground" aria-live="polite">
        {LOOK_LABEL[look]}
      </div>
      {!failed && SPHERE_STYLES.length > 1 && (
        <div className="flex gap-1 text-[11px]" role="radiogroup" aria-label="Sphere style">
          {SPHERE_STYLES.map(s => (
            <button
              key={s}
              role="radio"
              aria-checked={s === style}
              className={`rounded-full px-2 py-0.5 ${s === style ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              onClick={() => pick(s)}
            >
              {STYLE_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ overlay: live signals + the pill

function LiveOverlay() {
  const call = useCall();
  const navigate = useBbNavigate();
  useRealtime(LIVE_CHANNEL, payload => calls.receive(payload as LiveSignal));
  if (call.phase === "idle") return null;
  return (
    <div className="pointer-events-auto fixed bottom-5 right-20 z-50 flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs shadow-lg">
      <span className={`h-2 w-2 rounded-full ${call.phase === "live" ? (call.muted ? "bg-amber-500" : "animate-pulse bg-emerald-500") : "bg-muted-foreground"}`} />
      <button className="hover:underline" onClick={() => navigate.toPluginPanel(PAGE)}>
        {call.phase === "live" ? (call.activity !== null ? "Concierge is checking…" : call.muted ? "Concierge (muted)" : "Concierge listening") : "Concierge…"}
      </button>
      {call.phase === "live" && (
        <button className="rounded px-1 hover:bg-muted/50" onClick={() => calls.toggleMute()}>
          {call.muted ? "Unmute" : "Mute"}
        </button>
      )}
      <button className="rounded px-1 text-red-600 hover:bg-muted/50" onClick={() => void calls.stop()}>
        End
      </button>
    </div>
  );
}

export default definePluginApp(app => {
  app.slots.navPanel({ id: PAGE, title: "Voice concierge", icon: "Mic", path: PAGE, component: ConciergePage });
  app.slots.experimental_appOverlay({ id: "live", component: LiveOverlay });
});
