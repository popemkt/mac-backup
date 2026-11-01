// bb-plugin-voice-concierge — the frontend. The call itself (microphone, WebRTC peer, speaker) lives in a module-level
// CallManager so it survives moving around bb; the "Voice concierge" page starts and ends calls and shows the
// conversation, and an app overlay keeps a small live pill (mute, hang up) on every page while a call is up.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { definePluginApp, ThreadChat, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { LiveSignal, rpcContract } from "./server.ts";
import { LIVE_CHANNEL, STYLE_CHANNEL, THREAD_CHANNEL } from "./core/live.ts";
import { DOCK_AFTER_MS, orbMinimized } from "./core/orb.ts";
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

/** What a command or the sidebar button needs to start a call from anywhere; the always-mounted overlay fills it. */
const anywhere: { rpc: Rpc | null; open: (() => void) | null } = { rpc: null, open: null };

/** Open the Voice concierge page and start talking; during a call, hang up. */
function talkOrHangUp(): void {
  const { phase } = calls.snapshot();
  if (phase === "live" || phase === "connecting") {
    void calls.stop();
    return;
  }
  anywhere.open?.();
  if (phase === "idle" && anywhere.rpc !== null) void calls.start(anywhere.rpc);
}

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
  const [hasContent, setHasContent] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const refreshThread = useCallback(() => {
    rpc.call("thread").then(
      r => (setThreadId(r.threadId), setHasContent(!r.fresh)),
      () => setThreadId(null),
    );
  }, [rpc]);
  useRealtime(THREAD_CHANNEL, payload => {
    const id = (payload as { threadId?: unknown }).threadId;
    if (typeof id === "string") setThreadId(id);
    refreshThread();
  });

  const refreshStatus = useCallback(() => {
    setStatusError(null);
    rpc.call("status").then(setStatus, e => setStatusError(message(e)));
    refreshThread();
  }, [rpc, refreshThread]);
  useEffect(refreshStatus, [refreshStatus]);
  useEffect(() => {
    if (login !== null && call.revision > 0) refreshStatus();
    else if (call.revision > 0 && !hasContent) refreshThread(); // a spoken line may have reached the thread
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

      <TalkingSphere hasContent={hasContent} />

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

      {threadId !== undefined && threadId !== null && (
        <div className="-mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Conversation</span>
          <button
            className="underline disabled:opacity-50"
            disabled={renewing || call.phase !== "idle"}
            title={call.phase !== "idle" ? "Hang up first" : "Start over in a new thread; this one stays in your threads"}
            onClick={() => {
              setRenewing(true);
              rpc.call("newThread").then(
                r => (setThreadId(r.threadId), setHasContent(false), setRenewing(false)),
                e => (setStatusError(message(e)), setRenewing(false)),
              );
            }}
          >
            {renewing ? "Starting…" : "New conversation"}
          </button>
        </div>
      )}
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

const ORB_LARGE = "min(36vh, 300px)";
const ORB_DOCKED = "56px";
const ORB_EASE = "cubic-bezier(0.22, 0.8, 0.25, 1)";

/**
 * The sphere above the controls; it reads the call's state and voice levels itself, every frame. With auto-minimize
 * (core/orb.ts) it docks small during a call so more of the conversation shows, still animated and still reacting
 * to voice; a tap or the toggle switches size by hand, and a resting mouse opens it up.
 */
function TalkingSphere({ hasContent }: { hasContent: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const { phase } = useCall();
  const canvas = useRef<HTMLCanvasElement>(null);
  const sphere = useRef<{ sphere: Sphere; unsubscribe: () => void } | null>(null);
  const [look, setLook] = useState<SphereLook>("idle");
  const [failed, setFailed] = useState(false);
  const [style, setStyle] = useState<SphereStyle | null>(null);
  const [auto, setAuto] = useState(true);
  const [settled, setSettled] = useState(false);
  const [override, setOverride] = useState<boolean | null>(null);
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef(0);
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    rpc.call("style").then(
      r => (setStyle(isSphereStyle(r.style) ? r.style : "jelly"), setAuto(r.autoMinimize)),
      () => setStyle("jelly"),
    );
  }, [rpc]);
  useRealtime(STYLE_CHANNEL, payload => {
    const p = payload as { style?: string; autoMinimize?: unknown };
    if (isSphereStyle(p.style ?? "")) setStyle(p.style as SphereStyle);
    if (typeof p.autoMinimize === "boolean") setAuto(p.autoMinimize);
  });
  // A change of call phase hands the size back to the rule; a live call settles after a few seconds.
  useEffect(() => {
    setOverride(null);
    setSettled(false);
    if (phase !== "live") return;
    const t = setTimeout(() => setSettled(true), DOCK_AFTER_MS);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const docked = orbMinimized({ auto, phase, hasContent, settled, override, hovered: false });
  const small = !failed && orbMinimized({ auto, phase, hasContent, settled, override, hovered });
  const toggle = () => {
    clearTimeout(hoverTimer.current);
    setHovered(false);
    setOverride(!docked);
  };
  const onEnter = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || !docked) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(true), 250);
  };
  const onLeave = () => {
    clearTimeout(hoverTimer.current);
    setHovered(false);
  };
  const motion = (props: string) => (reduced ? "none" : props.split(",").map(p => `${p.trim()} 480ms ${ORB_EASE}`).join(", "));
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
    <div className="relative flex flex-col items-center gap-1" onPointerEnter={onEnter} onPointerLeave={onLeave}>
      {!failed && (
        <button
          type="button"
          className="absolute right-0 top-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50"
          aria-pressed={docked}
          title={docked ? "Show the sphere large" : "Dock the sphere small"}
          onClick={toggle}
        >
          {docked ? "Expand" : "Minimize"}
        </button>
      )}
      {!failed && (
        <canvas
          ref={canvas}
          className="aspect-square cursor-pointer"
          style={{ height: small ? ORB_DOCKED : ORB_LARGE, transition: motion("height") }}
          aria-hidden="true"
          onClick={toggle}
        />
      )}
      <div className="text-xs text-muted-foreground" aria-live="polite">
        {LOOK_LABEL[look]}
      </div>
      {!failed && SPHERE_STYLES.length > 1 && (
        <div
          className="grid"
          style={{ gridTemplateRows: small ? "0fr" : "1fr", opacity: small ? 0 : 1, transition: motion("grid-template-rows, opacity") }}
          aria-hidden={small}
        >
          <div className="flex min-h-0 gap-1 overflow-hidden text-[11px]" role="radiogroup" aria-label="Sphere style">
            {SPHERE_STYLES.map(s => (
              <button
                key={s}
                role="radio"
                aria-checked={s === style}
                tabIndex={small ? -1 : undefined}
                className={`rounded-full px-2 py-0.5 ${s === style ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                onClick={() => pick(s)}
              >
                {STYLE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ overlay: live signals + the pill

function LiveOverlay() {
  const call = useCall();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => {
    anywhere.rpc = rpc;
    anywhere.open = () => navigate.toPluginPanel(PAGE);
  }, [rpc, navigate]);
  const touch = useTouch();
  useRealtime(LIVE_CHANNEL, payload => calls.receive(payload as LiveSignal));
  if (call.phase === "idle") {
    // On a touch screen, a small mic button stays one tap away on every page.
    return touch ? (
      <button
        className="pointer-events-auto fixed bottom-20 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background shadow-lg"
        aria-label="Talk to the voice concierge"
        onClick={talkOrHangUp}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
        </svg>
      </button>
    ) : null;
  }
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

/** True on a device whose main pointer is a finger. */
function useTouch(): boolean {
  const [touch, setTouch] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const q = matchMedia("(pointer: coarse)");
    const on = () => setTouch(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return touch;
}

export default definePluginApp(app => {
  app.slots.navPanel({ id: PAGE, title: "Voice concierge", icon: "Mic", path: PAGE, component: ConciergePage });
  app.slots.experimental_appOverlay({ id: "live", component: LiveOverlay });
  // From anywhere: the command palette and a keyboard shortcut (rebindable), and one click in the sidebar footer.
  app.commands.register({ id: "talk", title: "Voice concierge: talk / hang up", defaultShortcut: { key: "m", mod: true, shift: true }, run: talkOrHangUp });
  app.slots.sidebarFooterAction({ id: "talk", title: "Talk to the voice concierge", icon: "Mic", run: talkOrHangUp });
});
