// bb-plugin-voice-concierge — the frontend. The call itself (microphone, WebRTC peer, speaker) lives in a module-level
// CallManager so it survives moving around bb; the "Voice concierge" page starts and ends calls and shows the
// conversation, and an app overlay keeps a small live pill (mute, hang up) on every page while a call is up.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { definePluginApp, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { LiveSignal, rpcContract } from "./server.ts";
import { LIVE_CHANNEL } from "./core/live.ts";

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
      // The realtime events channel Codex's call expects next to the audio.
      pc.createDataChannel("oai-events");
      this.speaker ??= Object.assign(document.createElement("audio"), { autoplay: true });
      pc.ontrack = e => {
        if (this.speaker !== null) this.speaker.srcObject = e.streams[0] ?? new MediaStream([e.track]);
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

  async say(text: string): Promise<void> {
    const id = this.state.conversationId;
    if (id === null || this.rpc === null) return;
    await this.rpc.call("sendText", { conversationId: id, text });
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

  private teardown(): void {
    this.pc?.close();
    this.pc = null;
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
    if (this.speaker !== null) this.speaker.srcObject = null;
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
type Line = { at: number; role: string; text: string };

function ConciergePage() {
  const rpc = useRpc<typeof rpcContract>();
  const call = useCall();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [login, setLogin] = useState<{ url: string; code: string } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(() => {
    setStatusError(null);
    rpc.call("status").then(setStatus, e => setStatusError(message(e)));
  }, [rpc]);
  useEffect(refreshStatus, [refreshStatus]);
  useEffect(() => {
    rpc.call("transcript", { limit: 200 }).then(r => setLines(r.lines), () => {});
  }, [rpc, call.revision]);
  useEffect(() => {
    if (login !== null && call.revision > 0) refreshStatus();
  }, [call.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  // A block body: newer browsers return a Promise from scrollIntoView, and React would call it as the cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lines.length, call.caption?.text]);

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

      <div className="flex flex-wrap items-center gap-2">
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
        {call.activity !== null && <span className="truncate text-xs text-muted-foreground">⋯ {call.activity}</span>}
      </div>
      {call.error !== null && <div className="text-xs text-destructive">{call.error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border p-3">
        {lines.length === 0 && call.caption === null && <div className="text-xs text-muted-foreground">Nothing said yet. Press Talk and ask “what’s running and what needs me?”</div>}
        {lines.map((l, i) => (
          <TranscriptRow key={`${l.at}-${i}`} role={l.role} text={l.text} at={l.at} />
        ))}
        {call.caption !== null && <TranscriptRow role={call.caption.role} text={call.caption.text} at={null} />}
        <div ref={bottom} />
      </div>

      <form
        className="flex items-center gap-2 pr-14"
        onSubmit={e => {
          e.preventDefault();
          const text = draft.trim();
          if (text === "" || !live) return;
          setDraft("");
          void calls.say(text);
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground"
          placeholder={live ? "Type instead of speaking…" : "Start a call to type or speak"}
          value={draft}
          disabled={!live}
          onChange={e => setDraft(e.target.value)}
        />
        <button className="rounded border border-border px-3 py-1 hover:bg-muted/50 disabled:opacity-50" disabled={!live || draft.trim() === ""}>
          Send
        </button>
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => rpc.call("clearTranscript").then(() => setLines([]), () => {})}
        >
          clear
        </button>
      </form>
    </div>
  );
}

function TranscriptRow({ role, text, at }: { role: string; text: string; at: number | null }) {
  const who = role === "user" ? "You" : role === "system" ? "" : "Concierge";
  if (role === "system") return <div className="py-1 text-center text-xs text-muted-foreground">{text}</div>;
  return (
    <div className={`flex flex-col py-1 ${role === "user" ? "items-end" : "items-start"}`}>
      <div className="text-[10px] text-muted-foreground">
        {who}
        {at === null ? " …" : ` · ${new Date(at).toLocaleTimeString()}`}
      </div>
      <div className={`max-w-[80%] rounded px-2 py-1 ${role === "user" ? "bg-muted" : "border border-border"} ${at === null ? "opacity-70" : ""}`}>{text}</div>
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
