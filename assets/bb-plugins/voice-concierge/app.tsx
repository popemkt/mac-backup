// bb-plugin-voice-concierge — the frontend. The call itself (microphone, WebRTC peer, speaker) lives in a module-level
// CallManager so it survives moving around bb. Every call talks to one thread (core/call-target.ts): Talk in a
// thread's header calls that thread, the "Voice concierge" page calls the concierge's own. An app overlay keeps a
// small live pill (the thread's name, mute, hang up, move here) on every page while a call is up.
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { definePluginApp, experimental_copyToClipboard, ThreadChat, useBbContext, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { CallTarget, LiveSignal, rpcContract } from "./server.ts";
import { LIVE_CHANNEL, STYLE_CHANNEL, THREAD_CHANNEL } from "./core/live.ts";
import { DOCK_AFTER_MS, DOCK_SOON_MS, orbMinimized } from "./core/orb.ts";
import { barHint, friendlyError, idleHint, stateLabel, SUGGESTIONS } from "./core/copy.ts";
import { DEFAULT_TUNE, defaultsFor, knobsFor, formatKnob, type Tune, type TunePatch, SettingsSaver } from "./core/look.ts";
import { controlsFor, VISUALS, INTERACTION_HINTS } from "./core/visuals.ts";
import { isSphereStyle, SPHERE_STYLES, STYLE_LABELS, STYLE_SWATCHES, type SphereStyle } from "./core/sphere-styles.ts";
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
  /** The thread the call was asked to talk to while it connects (null: the concierge's own). */
  asked: string | null;
  /** The thread the live call talks to; it stays pinned there until the person moves it. */
  target: CallTarget | null;
}

/** One call at a time, for the whole app. */
class CallManager {
  private state: CallState = { phase: "idle", conversationId: null, muted: false, error: null, caption: null, activity: null, revision: 0, asked: null, target: null };
  private readonly listeners = new Set<() => void>();
  private pc: RTCPeerConnection | null = null;
  /** Bumped by every start and stop; see start(). */
  private attempts = 0;
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

  /**
   * Start a call that talks to `threadId` (the thread the person started it from), or to the concierge's own thread.
   * Only ever called from the person's own click, tap or shortcut: nothing else opens the microphone.
   */
  async start(rpc: Rpc, threadId: string | null = null): Promise<void> {
    if (this.state.phase !== "idle") return;
    // Each attempt has its own number; hanging up (or a newer attempt) makes it stale, and a stale attempt stops what
    // it opened and touches nothing else, so a permission prompt answered after Cancel never starts a call.
    const attempt = ++this.attempts;
    const stale = () => attempt !== this.attempts;
    this.rpc = rpc;
    this.set({ phase: "connecting", error: null, caption: null, activity: null, asked: threadId, target: null });
    let mic: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    const abandon = () => {
      pc?.close();
      for (const t of mic?.getTracks() ?? []) t.stop();
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This page cannot use the microphone (it needs https or localhost, and microphone permission)");
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (stale()) return abandon();
      this.mic = mic;
      pc = new RTCPeerConnection();
      this.pc = pc;
      for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
      this.meters.mic = this.meter(mic);
      // The realtime events channel Codex's call expects next to the audio.
      pc.createDataChannel("oai-events");
      this.speaker ??= Object.assign(document.createElement("audio"), { autoplay: true });
      const peer = pc;
      peer.ontrack = e => {
        if (this.pc !== peer) return;
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        if (this.speaker !== null) this.speaker.srcObject = stream;
        this.meters.remote?.close();
        this.meters.remote = this.meter(stream);
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" && this.pc === peer) void this.stop("The voice connection failed");
      };
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc, 2_000);
      if (stale()) return abandon();
      const { conversationId, sdp, target } = await rpc.call("start", { sdp: pc.localDescription?.sdp ?? "", threadId });
      if (stale()) {
        // hung up while connecting: the call exists on the server now, so end it there too
        abandon();
        await rpc.call("stop", { conversationId }).catch(() => {});
        return;
      }
      await pc.setRemoteDescription({ type: "answer", sdp });
      if (stale()) {
        abandon();
        await rpc.call("stop", { conversationId }).catch(() => {});
        return;
      }
      this.set({ phase: "live", conversationId, muted: false, target });
    } catch (e) {
      if (stale()) return abandon(); // a newer call (or the hang-up) owns the state now
      this.teardown();
      this.set({ phase: "idle", error: message(e), asked: null, target: null });
    }
  }

  /** Move the live call to another thread (null: the concierge's own); it stays there until moved again. */
  async retarget(threadId: string | null): Promise<void> {
    const id = this.state.conversationId;
    if (this.state.phase !== "live" || id === null || this.rpc === null) return;
    try {
      const target = await this.rpc.call("retarget", { conversationId: id, threadId });
      if (this.state.conversationId === id) this.set({ target, error: null });
    } catch (e) {
      this.set({ error: message(e) });
    }
  }

  clearError(): void {
    if (this.state.error !== null) this.set({ error: null });
  }

  async stop(error: string | null = null): Promise<void> {
    this.attempts++; // any attempt still connecting is now stale
    const id = this.state.conversationId;
    this.set({ phase: "ending" });
    this.teardown();
    if (id !== null && this.rpc !== null) await this.rpc.call("stop", { conversationId: id }).catch(() => {});
    this.set({ phase: "idle", conversationId: null, caption: null, activity: null, error, asked: null, target: null });
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = !muted;
    this.set({ muted });
  }

  receive(signal: LiveSignal): void {
    const { event } = signal;
    // Another call's events (another device, another tab) are not this page's: idle, it takes only events that belong
    // to no call (a sign-in finishing); in a call, only its own.
    if (signal.conversationId !== null) {
      if (this.state.phase === "idle") return;
      // While connecting, this call's id is not known yet: every call's events are another call's.
      if (signal.conversationId !== this.state.conversationId) return;
    }
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
          this.attempts++;
          this.teardown();
          this.set({ phase: "idle", conversationId: null, caption: null, activity: null, revision: this.state.revision + 1, asked: null, target: null });
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

/**
 * What a command or the sidebar button needs to start a call from anywhere; the always-mounted overlay fills it.
 * `threadId`: the thread on screen (from the route), null on any other page.
 */
const anywhere: { rpc: Rpc | null; open: (() => void) | null; threadId: string | null } = { rpc: null, open: null, threadId: null };

/**
 * Talk to the thread on screen, or, on any other page, open the Voice concierge page and talk to the concierge;
 * during a call, hang up.
 */
function talkOrHangUp(): void {
  const { phase } = calls.snapshot();
  if (phase === "live" || phase === "connecting") {
    void calls.stop();
    return;
  }
  const threadId = anywhere.threadId;
  if (threadId === null) anywhere.open?.();
  if (phase === "idle" && anywhere.rpc !== null) void calls.start(anywhere.rpc, threadId);
}

/** Who answers on this call, for captions and the pill: the thread's title, or "Concierge". */
const answerer = (t: CallTarget | null) => (t === null || t.concierge ? "Concierge" : t.title);

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

/** Whether the Voice concierge page is on screen: the overlay hides its floating controls there. */
const pageOpen = (() => {
  let count = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(l => l());
  return {
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    get: () => count > 0,
    mount: () => {
      count++;
      notify();
      return () => {
        count--;
        notify();
      };
    },
  };
})();
const usePageOpen = () => useSyncExternalStore(pageOpen.subscribe, pageOpen.get);

const EASE = "cubic-bezier(0.22, 0.8, 0.25, 1)";
const MS = 340;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const motion = (...props: string[]) => (reducedMotion() ? "none" : props.map(p => `${p} ${MS}ms ${EASE}`).join(", "));
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const HANG_UP = "bg-[#e5484d] text-white hover:bg-[#d93d42]";

/** The element's content size, kept current. */
function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: Math.round(e!.contentRect.width), height: Math.round(e!.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Keeps a chat's scroller at its newest message when its box changes size (the sphere's stage opening or closing
 * above it) or the chat is swapped (the call's timeline), unless the person has scrolled up to read. ThreadChat has
 * no scroll control of its own, so this finds its scroller inside the box.
 */
function useStickToEnd(box: React.RefObject<HTMLElement | null>, key: string): void {
  // whether the person was reading at the end; kept across a swap of the chat, so a reader scrolled up stays put
  const atEnd = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    let scroller: HTMLElement | null = null;
    let frame = 0;
    let retry = 0;
    const onScroll = () => {
      if (scroller !== null) atEnd.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
    };
    let scanned = -Infinity;
    let throttled = false;
    const find = () => {
      if (scroller?.isConnected) return scroller;
      const now = performance.now();
      throttled = now - scanned < 500; // a full scan at most twice a second, until it has something to scroll
      if (throttled) return null;
      scanned = now;
      scroller?.removeEventListener("scroll", onScroll);
      const all = [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))];
      scroller = all.find(n => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) ?? null;
      scroller?.addEventListener("scroll", onScroll, { passive: true });
      return scroller;
    };
    // after the box resizes or the chat's content changes (its first page landing, a new message), once per frame
    const stick = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const s = find();
        if (s !== null && atEnd.current) s.scrollTop = s.scrollHeight;
        else if (s === null && throttled && retry === 0) retry = window.setTimeout(() => ((retry = 0), stick()), 520);
      });
    };
    const ro = new ResizeObserver(stick);
    ro.observe(el);
    const mo = new MutationObserver(stick);
    mo.observe(el, { childList: true, subtree: true });
    stick();
    return () => (ro.disconnect(), mo.disconnect(), cancelAnimationFrame(frame), clearTimeout(retry), scroller?.removeEventListener("scroll", onScroll));
  }, [box, key]);
}

/** Sets `inert` on an element (React 18 does not pass the attribute through). */
function useInert(ref: React.RefObject<HTMLElement | null>, inert: boolean): void {
  useEffect(() => {
    if (ref.current !== null) ref.current.inert = inert;
  }, [ref, inert]);
}

function sphereMode(s: CallState): SphereMode {
  if (s.phase === "connecting") return "connecting";
  if (s.phase !== "live") return "idle";
  return s.activity !== null ? "thinking" : "live";
}

/** Where the sphere's canvas is drawn, in the page's coordinates (CSS px). */
interface Place {
  x: number;
  y: number;
  size: number;
}

/**
 * The page. Stacked (phones, narrow panels): the sphere large on top, the conversation, and a call bar at the bottom
 * within thumb reach. During a call, with auto-minimize (core/orb.ts), the sphere glides into the bar and the
 * conversation takes the room. Side by side (wide screens, a phone held sideways): the sphere and controls left, the
 * conversation right.
 */
function ConciergePage() {
  const rpc = useRpc<typeof rpcContract>();
  const call = useCall();
  const { phase } = call;
  const root = useRef<HTMLDivElement>(null);
  const size = useSize(root);
  const side = size.width > 0 && ((size.height < 560 && size.width >= 520) || size.width >= 880);
  const compact = size.width > 0 && size.width < 640;
  const touch = useTouch();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [login, setLogin] = useState<{ url: string; code: string } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [threadId, setThreadId] = useState<string | null | undefined>(undefined);
  const [hasContent, setHasContent] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [look, setLook] = useState<SphereLook>("idle");
  const [style, setStyle] = useState<SphereStyle | null>(null);
  const [auto, setAuto] = useState(true);
  const [tunes, setTunes] = useState<Partial<Record<SphereStyle, Tune>>>({});
  const [tuning, setTuning] = useState(false);
  const tuneButton = useRef<HTMLButtonElement>(null);
  const closeTuning = useCallback(() => setTuning(false), []);
  const [tuneError, setTuneError] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const styleSaver = useRef<SettingsSaver<unknown, "style", { value: SphereStyle }> | null>(null);
  if (styleSaver.current === null) {
    styleSaver.current = new SettingsSaver(
      (_key, patch) => rpc.call("setStyle", { style: patch.value }).then(r => (setStyleError(null), r)),
      e => setStyleError(message(e)),
    );
  }
  const saver = useRef<SettingsSaver<Record<string, Tune>> | null>(null);
  if (saver.current === null) {
    saver.current = new SettingsSaver(
      (s, patch) => rpc.call("setTune", { style: s, tune: patch }).then(r => (setTuneError(null), r.tunes)),
      e => setTuneError(message(e)),
    );
    // once every change is written, show what the server has (the settings it clamped and stored)
    saver.current.onSettled = t => setTunes(t as Record<SphereStyle, Tune>);
  }
  const [settled, setSettled] = useState(false);
  const [brief, setBrief] = useState(false);
  const [override, setOverride] = useState<boolean | null>(null);
  const [peek, setPeek] = useState(false);
  const [sphereFailed, setSphereFailed] = useState(false);
  const peekTimer = useRef(0);
  useEffect(() => {
    const leave = pageOpen.mount();
    return leave;
  }, []);

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
    setChecking(true);
    rpc.call("status").then(
      s => (setStatus(s), setChecking(false), s.ready && setLogin(null)),
      e => (setStatusError(message(e)), setChecking(false)),
    );
    refreshThread();
  }, [rpc, refreshThread]);
  useEffect(refreshStatus, [refreshStatus]);
  useEffect(() => {
    if (login !== null && call.revision > 0) refreshStatus();
    else if (call.revision > 0 && !hasContent) refreshThread(); // a spoken line may have reached the thread
  }, [call.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    rpc.call("style").then(
      r => {
        if (styleSaver.current?.quiet() !== false) setStyle(isSphereStyle(r.style) ? r.style : "jelly");
        setAuto(r.autoMinimize);
        if (saver.current?.quiet() !== false) setTunes(r.tunes as Record<SphereStyle, Tune>);
      },
      () => setStyle("jelly"),
    );
  }, [rpc]);
  useRealtime(STYLE_CHANNEL, payload => {
    const p = payload as { style?: string; autoMinimize?: unknown; tunes?: Record<SphereStyle, Tune> };
    if (isSphereStyle(p.style ?? "") && styleSaver.current?.quiet() !== false) setStyle(p.style as SphereStyle);
    if (typeof p.autoMinimize === "boolean") setAuto(p.autoMinimize);
    // a knob being moved here wins over the echo of its own saves
    if (p.tunes !== undefined && saver.current?.quiet() !== false) setTunes(p.tunes);
  });
  useEffect(() => () => { saver.current?.flush(); styleSaver.current?.flush(); }, []);
  // A change of call phase hands the size back to the rule; a live call settles after a few seconds.
  useEffect(() => {
    setOverride(null);
    setSettled(false);
    setBrief(false);
    if (phase !== "live") return;
    const soon = setTimeout(() => setBrief(true), DOCK_SOON_MS);
    const later = setTimeout(() => setSettled(true), DOCK_AFTER_MS);
    return () => (clearTimeout(soon), clearTimeout(later));
  }, [phase]);
  useEffect(() => () => clearTimeout(peekTimer.current), []);

  const ready = status?.ready === true;
  const needsLogin = status?.needsLogin === true;
  const error = call.error !== null && call.error !== dismissed ? call.error : null;
  const setup = status !== null && !status.ready;
  const docked = !side && orbMinimized({ auto, phase, hasContent, settled, brief, override, hovered: false });
  const signIn = () => {
    setSigningIn(true);
    rpc.call("login").then(
      l => (setLogin(l), setSigningIn(false)),
      e => (setStatusError(message(e)), setSigningIn(false)),
    );
  };
  const pick = (next: SphereStyle) => {
    setStyle(next);
    styleSaver.current?.edit("style", { value: next });
  };
  const tune = style !== null ? (tunes[style] ?? defaultsFor(style)) : DEFAULT_TUNE;
  // A knob moves the sphere at once; the setting is saved a moment after the last change (null resets the knob).
  const retune = (patch: TunePatch) => {
    if (style === null) return;
    const next = { ...tune };
    for (const k of knobsFor(style)) if (k in patch) next[k] = patch[k] ?? controlsFor(style)[k]!.default;
    setTunes(t => ({ ...t, [style]: next }));
    saver.current?.edit(style, patch);
  };
  // The sphere is a control too: idle, a tap starts the call; in a call, it docks or opens up.
  const tapSphere = () => {
    clearTimeout(peekTimer.current);
    setPeek(false);
    if (phase === "idle") {
      if (ready) void calls.start(rpc);
    } else if (!side) setOverride(!docked);
  };
  const toggleDock = () => setOverride(!docked);

  const labels = { look, phase, muted: call.muted, ready, checking, needsLogin };
  const label = stateLabel(labels);
  const caption = call.caption !== null ? { who: call.caption.role === "user" ? "You" : answerer(call.target), text: call.caption.text } : null;
  const hint = call.activity ?? (phase === "idle" && ready ? idleHint(touch, isMac()) : null);

  // The sphere's size and where it sits.
  const body = Math.max(0, size.height - 48);
  const S = side
    ? Math.round(Math.min(body * 0.4, size.width * 0.26, 240))
    : Math.round(!ready && !checking ? Math.min(body * 0.2, 140) : Math.min(body * 0.3, size.width * 0.62, 248));
  const largeSlot = useRef<HTMLDivElement>(null);
  const smallSlot = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  useLayoutEffect(() => {
    if (side || root.current === null) return;
    const slot = docked ? smallSlot.current : largeSlot.current;
    if (slot === null) return;
    const r = slot.getBoundingClientRect();
    const o = root.current.getBoundingClientRect();
    const small = 88; // the docked sphere's canvas: its halo spills a little past the 64 px slot
    const next = docked
      ? peek
        ? { x: r.left - o.left + 32 - 80, y: r.top - o.top + 32 - 80 - 40, size: 160 }
        : { x: r.left - o.left + 32 - small / 2, y: r.top - o.top + 32 - small / 2, size: small }
      : { x: r.left - o.left, y: r.top - o.top, size: S };
    if (place === null || Math.abs(place.x - next.x) + Math.abs(place.y - next.y) + Math.abs(place.size - next.size) > 0.5) setPlace(next);
  });

  const conversation = (
    <Conversation
      threadId={threadId}
      hasContent={hasContent}
      flush={compact && !side}
      inCall={phase !== "idle"}
      touch={touch}
      onSent={() => setHasContent(true)}
      onRenewed={id => (setThreadId(id), setHasContent(false))}
    />
  );
  const alert = error !== null && <ErrorBanner error={error} canRetry={ready && phase === "idle"} onRetry={() => void calls.start(rpc)} onDismiss={() => setDismissed(call.error)} />;
  // While voice is being set up, the setup card says it all: no sphere.
  const sphere = !sphereFailed && !setup && style !== null && (
    <Orb
      key={side ? "side" : "stack"}
      style={style}
      tune={tune}
      place={side ? null : place}
      base={S}
      small={docked && !peek}
      label={phase === "idle" ? (ready ? "Start talking" : "The sphere") : docked ? "Show the sphere large" : "Dock the sphere small"}
      onTap={tapSphere}
      onPeek={on => {
        clearTimeout(peekTimer.current);
        if (!on) setPeek(false);
        else if (docked) peekTimer.current = window.setTimeout(() => setPeek(true), 250);
      }}
      onLook={setLook}
      onFail={() => setSphereFailed(true)}
    />
  );

  return (
    <div ref={root} className="relative flex h-full min-h-0 flex-col overflow-hidden text-sm">
      <StatusLine status={status} error={statusError} checking={checking} phase={phase} muted={call.muted} onRefresh={refreshStatus} />
      {call.target !== null && !call.target.concierge && <ElsewhereBar target={call.target} />}
      {status !== null && !status.ready && (
        <SetupCard status={status} login={login} signingIn={signingIn} onSignIn={signIn} onRefresh={refreshStatus} />
      )}
      {side ? (
        <div
          className="flex min-h-0 flex-1 gap-5 px-4 pb-3"
          // a phone held sideways: keep the conversation clear of the floating button in the bottom-right corner
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", paddingRight: size.width < 880 ? 72 : undefined }}
        >
          {/* centred while it fits; when it does not (a long error on a short screen), it scrolls from the top */}
          <div className="flex w-[40%] min-w-0 max-w-[420px] shrink-0 flex-col items-center gap-1 overflow-y-auto py-1 [&>:first-child]:mt-auto [&>:last-child]:mb-auto">
            {/* the sphere is decoration: while an error shows, the error and its way out come first, in its place */}
            {error === null ? sphere : alert}
            <StateText label={label} caption={caption} hint={hint} live={phase !== "idle"} />
            <div className="mt-2">
              <Controls size="large" ready={ready} narrow={size.width < 760} />
            </div>
            {phase === "idle" && ready && <StylePicker error={styleError} style={style} onPick={pick} tuning={tuning} onTuning={setTuning} toggle={tuneButton} />}
          </div>
          {conversation}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <TopStage collapsed={docked || setup} canDock={phase !== "idle" && !sphereFailed} onDock={toggleDock}>
            <div ref={largeSlot} className="shrink-0" style={{ width: S, height: sphereFailed ? 8 : S }} aria-hidden="true" />
            <StateText label={label} caption={caption} hint={hint} live={phase !== "idle"} />
            {phase === "idle" && ready && !sphereFailed && <StylePicker error={styleError} style={style} onPick={pick} tuning={tuning} onTuning={setTuning} toggle={tuneButton} />}
          </TopStage>
          {alert !== false && <div className="px-4 pb-2">{alert}</div>}
          {conversation}
          <CallBar slot={smallSlot} docked={docked} ready={ready} checking={checking} label={label} caption={caption} hint={barHint(labels)} onOpen={toggleDock} />
        </div>
      )}
      {!side && sphere}
      {tuning && style !== null && phase === "idle" && (
        <TunePanel style={style} tune={tune} onTune={retune} error={tuneError} opens={side ? "right" : "below"} root={root} anchor={tuneButton} onClose={closeTuning} />
      )}
    </div>
  );
}

/** The sphere's canvas. Stacked, it floats over the page and glides between its places by transform (the canvas
 * keeps one size, so nothing is reallocated while it moves); side by side, it sits in the flow. */
function Orb(props: {
  style: SphereStyle;
  tune: Tune;
  place: Place | null;
  base: number;
  small: boolean;
  label: string;
  onTap: () => void;
  onPeek: (on: boolean) => void;
  onLook: (look: SphereLook) => void;
  onFail: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const spaceArmed = useRef(false);
  const [aligned, setAligned] = useState(false);
  const sphere = useRef<{ sphere: Sphere; unsubscribe: () => void } | null>(null);
  const { style, tune, place, base, small } = props;
  useEffect(() => {
    if (canvas.current === null) return;
    if (sphere.current !== null) {
      try {
        sphere.current.sphere.setStyle(style);
        sphere.current.sphere.setTune(tune);
      } catch { props.onFail(); }
      return;
    }
    let s: Sphere;
    try {
      s = new Sphere(canvas.current, style, {
        read: () => {
          const c = calls.snapshot();
          return { mode: sphereMode(c), levels: calls.levels(), muted: c.muted };
        },
        onLook: props.onLook,
        onUnavailable: props.onFail,
        onAlignment: setAligned,
      });
    } catch {
      props.onFail(); // no WebGL2: the page works without the sphere
      return;
    }
    s.setTune(tune);
    sphere.current = { sphere: s, unsubscribe: calls.subscribe(() => s.kick()) };
  }, [style]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    sphere.current?.sphere.setTune(tune);
  }, [tune]);
  useEffect(
    () => () => {
      sphere.current?.unsubscribe();
      sphere.current?.sphere.dispose();
      sphere.current = null;
    },
    [],
  );
  // Small, it renders at a lower resolution (after the glide, so the backing store changes once).
  useEffect(() => {
    const t = setTimeout(() => sphere.current?.sphere.setDetail(small ? Math.max(0.3, 96 / base) : 1), small ? MS : 0);
    return () => clearTimeout(t);
  }, [small, base]);
  useEffect(() => {
    sphere.current?.sphere.clearPointer();
    press.current = null;
    dragged.current = false;
    spaceArmed.current = false;
  }, [small, style]);
  const floating = place !== null;
  const interactive = !small && VISUALS[style].interaction !== "call";
  const activate = () => {
    if (!interactive || !sphere.current?.sphere.activate()) props.onTap();
  };
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    sphere.current?.sphere.point(2 * (e.clientX - r.left) / r.width - 1, 1 - 2 * (e.clientY - r.top) / r.height);
  };
  const interactionLabel = { align: aligned ? "Unfold the chrome rings" : "Align the chrome rings", squish: "Squish the glowing orb", morph: "Pulse the gradient blob", call: props.label }[VISUALS[style].interaction];
  return (
    <canvas
      ref={canvas}
      role="button"
      tabIndex={0}
      aria-label={interactive ? interactionLabel : props.label}
      aria-pressed={interactive && VISUALS[style].interaction === "align" ? aligned : undefined}
      className={`shrink-0 cursor-pointer touch-manipulation rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${floating ? "absolute left-0 top-0 z-10" : ""}`}
      style={
        floating
          ? {
              width: base,
              height: base,
              touchAction: interactive ? "none" : "manipulation",
              transformOrigin: "0 0",
              transform: `translate(${place.x}px, ${place.y}px) scale(${place.size / base})`,
              transition: motion("transform"),
            }
          : { width: base, height: base, touchAction: interactive ? "none" : "manipulation" }
      }
      onClick={() => { if (!dragged.current) activate(); dragged.current = false; }}
      onKeyDown={e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (e.key === " " && !e.repeat) { spaceArmed.current = true; if (interactive) sphere.current?.sphere.setPressed(true); }
        if (e.key === "Enter" && !e.repeat) { if (interactive) sphere.current?.sphere.setPressed(true); activate(); }
      }}
      onKeyUp={e => {
        if (e.key === "Enter") { sphere.current?.sphere.setPressed(false); return; }
        if (e.key !== " ") return;
        e.preventDefault();
        sphere.current?.sphere.setPressed(false);
        if (spaceArmed.current) activate();
        spaceArmed.current = false;
      }}
      onBlur={() => {
        spaceArmed.current = false;
        sphere.current?.sphere.clearPointer();
      }}
      onPointerDown={e => {
        dragged.current = false;
        if (!interactive || !e.isPrimary || e.button !== 0) return;
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        point(e);
        sphere.current?.sphere.setPressed(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={e => {
        if (press.current?.id !== e.pointerId) return;
        press.current = null;
        sphere.current?.sphere.setPressed(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (e.pointerType !== "mouse") sphere.current?.sphere.clearPointer();
      }}
      onPointerMove={e => {
        if (!interactive) return;
        const down = press.current;
        if (down && down.id !== e.pointerId) return;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) dragged.current = true;
        point(e);
      }}
      onPointerEnter={e => e.pointerType === "mouse" && props.onPeek(true)}
      onPointerLeave={() => { if (press.current === null) sphere.current?.sphere.clearPointer(); props.onPeek(false); }}
      onPointerCancel={() => {
        press.current = null;
        dragged.current = true;
        sphere.current?.sphere.clearPointer();
      }}
      onLostPointerCapture={() => {
        if (press.current === null) return;
        press.current = null;
        dragged.current = true;
        sphere.current?.sphere.clearPointer();
      }}
    />
  );
}

function TopStage({ collapsed, canDock, onDock, children }: { collapsed: boolean; canDock: boolean; onDock: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useInert(ref, collapsed);
  return (
    <div
      ref={ref}
      className="relative grid shrink-0"
      style={{ gridTemplateRows: collapsed ? "0fr" : "1fr", opacity: collapsed ? 0 : 1, transition: motion("grid-template-rows", "opacity") }}
    >
      <div className="flex min-h-0 flex-col items-center overflow-hidden px-4 pt-1">{children}</div>
      {canDock && (
        <button
          className="absolute right-2 top-0 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60"
          aria-label="Dock the sphere small"
          title="Dock the sphere small"
          onClick={onDock}
        >
          <Icon name="minimize" />
        </button>
      )}
    </div>
  );
}

function StateText({ label, caption, hint, live }: { label: string; caption: { who: string; text: string } | null; hint: string | null; live: boolean }) {
  return (
    <div className="flex w-full flex-col items-center pb-1 pt-2 text-center">
      <div className="text-[15px] font-medium tracking-tight" aria-live="polite">
        {label}
      </div>
      <div
        className={`mt-1 max-w-[40ch] text-balance leading-snug ${caption !== null ? "text-[14px]" : "text-xs text-muted-foreground"} ${live && caption !== null ? "min-h-[2.6em]" : ""}`}
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {caption !== null ? (
          <>
            <span className={`mr-1 text-[11px] font-medium uppercase tracking-wide ${caption.who === "You" ? "text-muted-foreground" : "text-foreground"}`}>{caption.who}</span>
            {caption.text}
          </>
        ) : (
          hint
        )}
      </div>
    </div>
  );
}

/** The bottom bar of the stacked page: Talk while idle; in a call, the docked sphere's place, the state, mute, hang up. */
function CallBar(props: {
  slot: React.RefObject<HTMLDivElement | null>;
  docked: boolean;
  ready: boolean;
  label: string;
  caption: { who: string; text: string } | null;
  hint: string;
  checking: boolean;
  onOpen: () => void;
}) {
  const call = useCall();
  const inCall = call.phase === "live" || call.phase === "ending";
  const showText = props.docked && call.phase !== "idle";
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t border-border bg-background pl-3"
      // the right end stays clear of the round floating button bb (and plugins) keep in the bottom-right corner
      style={{ minHeight: 80, paddingRight: 76, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div ref={props.slot} className="h-16 shrink-0" style={{ width: props.docked ? 64 : 0, transition: motion("width") }} aria-hidden="true" />
      {showText ? (
        <button className="flex h-14 min-w-0 flex-1 flex-col justify-center rounded-xl px-1 text-left" onClick={props.onOpen} aria-label="Show the sphere large">
          <span className="truncate text-[14px] font-medium" aria-live="polite">
            {props.label}
          </span>
          <span className="truncate text-xs text-muted-foreground">{props.caption !== null ? `${props.caption.who}: ${props.caption.text}` : props.hint}</span>
        </button>
      ) : (
        <div className="flex-1" />
      )}
      {inCall || showText ? (
        <Controls size="compact" ready={props.ready} />
      ) : props.ready || props.checking || call.phase !== "idle" ? (
        <Controls size="large" ready={props.ready} wide />
      ) : null}
      {!inCall && !showText && <div className="flex-1" />}
    </div>
  );
}

function Controls({ size, ready, narrow = false, wide = false }: { size: "large" | "compact"; ready: boolean; narrow?: boolean; wide?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const call = useCall();
  const big = size === "large";
  if (call.phase === "live" || call.phase === "ending") {
    const ending = call.phase === "ending";
    const round = big ? "h-12 w-12" : "h-11 w-11";
    return (
      <div className="flex shrink-0 items-center gap-2">
        <button
          className={`${round} flex items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
            call.muted ? "border-amber-500/60 bg-amber-500/15 text-amber-500" : "border-border hover:bg-muted/60"
          }`}
          aria-label={call.muted ? "Unmute" : "Mute"}
          aria-pressed={call.muted}
          title={call.muted ? "Unmute" : "Mute"}
          disabled={ending}
          onClick={() => calls.toggleMute()}
        >
          <Icon name={call.muted ? "mic-off" : "mic"} size={20} />
        </button>
        <button
          className={`flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-60 ${HANG_UP} ${
            big && !narrow ? "h-12 px-6" : round
          }`}
          aria-label="Hang up"
          title="Hang up"
          disabled={ending}
          onClick={() => void calls.stop()}
        >
          <Icon name="phone-off" size={20} />
          {big && !narrow && <span>{ending ? "Ending…" : "Hang up"}</span>}
        </button>
      </div>
    );
  }
  const connecting = call.phase === "connecting";
  return (
    <button
      className={`flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40 ${
        big ? `h-12 px-7 text-[15px] ${wide ? "w-full max-w-[280px]" : "min-w-36"}` : "h-11 w-11"
      }`}
      disabled={!connecting && !ready}
      aria-label={connecting ? "Cancel the call" : "Talk"}
      title={connecting ? "Cancel" : ready ? "Start talking" : "Voice isn't ready yet"}
      onClick={() => (connecting ? void calls.stop() : void calls.start(rpc))}
    >
      <Icon name={connecting ? "spinner" : "mic"} size={20} className={connecting ? "animate-spin" : ""} />
      {big && <span>{connecting ? "Connecting… tap to cancel" : "Talk"}</span>}
    </button>
  );
}

/** On the concierge's page during a call with another thread: which thread is listening, and a way to bring it here. */
function ElsewhereBar({ target }: { target: CallTarget }) {
  const navigate = useBbNavigate();
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs" role="status">
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
      <span className="min-w-0 flex-1 truncate">
        This call is with <span className="font-medium">{target.title}</span>; its agent answers.
      </span>
      {target.threadId !== null && (
        <button className="h-8 shrink-0 rounded-md px-2 hover:bg-muted/70" onClick={() => navigate.toThread(target.threadId!)}>
          Open
        </button>
      )}
      <button className="h-8 shrink-0 rounded-md px-2 font-medium hover:bg-muted/70" onClick={() => void calls.retarget(null)}>
        Move here
      </button>
    </div>
  );
}

function StatusLine(props: { status: Status | null; error: string | null; checking: boolean; phase: Phase; muted: boolean; onRefresh: () => void }) {
  const { status, error, checking, phase } = props;
  const inCall = phase === "live" || phase === "connecting";
  const dot = inCall
    ? props.muted
      ? "bg-amber-500"
      : "bg-emerald-500"
    : checking
      ? "animate-pulse bg-muted-foreground"
      : error !== null
        ? "bg-red-500"
        : status?.ready
          ? "bg-emerald-500"
          : "bg-amber-500";
  const text = inCall
    ? props.muted
      ? "In a call · muted"
      : "In a call"
    : (error ?? (status === null ? "Checking voice…" : status.ready ? "Ready" : status.needsLogin ? "Sign-in needed" : "Not ready"));
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-4 text-xs text-muted-foreground">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="truncate font-medium text-foreground/80">{text}</span>
      {status?.where && !inCall && (
        <span className="truncate rounded-full border border-border px-2 py-0.5 text-[11px]" title={status.account ?? undefined}>
          {status.where}
        </span>
      )}
      {!inCall && (
        <button
          className="-mr-2 ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted/60 disabled:opacity-40"
          aria-label="Check again"
          title="Check again"
          disabled={checking}
          onClick={props.onRefresh}
        >
          <Icon name="refresh" className={checking ? "animate-spin" : ""} />
        </button>
      )}
    </div>
  );
}

function SetupCard(props: { status: Status; login: { url: string; code: string } | null; signingIn: boolean; onSignIn: () => void; onRefresh: () => void }) {
  const { status, login } = props;
  const [copied, setCopied] = useState(false);
  const step = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium";
  return (
    <div className="mx-4 mb-3 flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4">
      <div className="text-[15px] font-medium">{status.needsLogin ? "Sign in to start talking" : "Voice isn't ready yet"}</div>
      <div className="text-xs leading-relaxed text-muted-foreground">
        {status.needsLogin ? `Voice runs on your ChatGPT account, through ${status.where ?? "this machine"}. It isn't signed in there yet.` : status.message}
      </div>
      {status.needsLogin &&
        (login === null ? (
          <button
            className="flex h-11 items-center justify-center self-start rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            disabled={props.signingIn}
            onClick={props.onSignIn}
          >
            {props.signingIn ? "Opening sign-in…" : "Sign in with ChatGPT"}
          </button>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            <li className="flex items-center gap-3">
              <span className={step}>1</span>
              <a
                className="flex h-11 items-center gap-1.5 rounded-full border border-border px-4 font-medium hover:bg-muted/60"
                href={login.url}
                target="_blank"
                rel="noreferrer"
              >
                Open the sign-in page <Icon name="external" size={14} />
              </a>
            </li>
            <li className="flex flex-wrap items-center gap-3">
              <span className={step}>2</span>
              <span>Enter</span>
              <span className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-lg font-semibold tracking-widest">{login.code}</span>
              <button
                className="flex h-11 items-center gap-1.5 rounded-full px-3 hover:bg-muted/60"
                onClick={() => void experimental_copyToClipboard({ text: login.code }).then(ok => (setCopied(ok), setTimeout(() => setCopied(false), 1500)))}
              >
                <Icon name={copied ? "check" : "copy"} size={14} />
                {copied ? "Copied" : "Copy"}
              </button>
            </li>
            <li className="flex flex-wrap items-center gap-3 text-muted-foreground">
              <span className={step}>3</span>
              <Icon name="spinner" size={14} className="animate-spin" />
              <span>Waiting for you…</span>
              <button className="flex h-11 items-center rounded-full px-3 font-medium text-foreground hover:bg-muted/60" onClick={props.onRefresh}>
                I've signed in
              </button>
            </li>
          </ol>
        ))}
    </div>
  );
}

function ErrorBanner({ error, canRetry, onRetry, onDismiss }: { error: string; canRetry: boolean; onRetry: () => void; onDismiss: () => void }) {
  const { text, details } = friendlyError(error);
  return (
    <div role="alert" className="flex w-full flex-col gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[13px]">
      <div className="flex items-start gap-2">
        <Icon name="alert" className="mt-0.5 shrink-0 text-red-500" />
        <span className="leading-relaxed">{text}</span>
      </div>
      {details !== null && (
        <details className="pl-6 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Details</summary>
          <div className="mt-1 break-words font-mono">{details}</div>
        </details>
      )}
      <div className="flex justify-end gap-1">
        <button className="h-11 whitespace-nowrap rounded-full px-4 text-xs hover:bg-red-500/15" onClick={onDismiss}>
          Dismiss
        </button>
        {canRetry && (
          <button className="h-11 whitespace-nowrap rounded-full border border-red-500/40 px-4 text-xs font-medium hover:bg-red-500/15" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function StylePicker(props: {
  error: string | null;
  style: SphereStyle | null;
  onPick: (s: SphereStyle) => void;
  tuning: boolean;
  onTuning: (open: boolean) => void;
  /** The tune button, which the page's tuning panel sits next to. */
  toggle: React.RefObject<HTMLButtonElement | null>;
}) {
  const { style, onPick, tuning, toggle } = props;
  return (
    <div className="relative flex max-w-full flex-col items-center">
      <div className="flex max-w-full items-center">
        <div
          className="flex min-w-0 flex-wrap items-center justify-center"
          role="radiogroup"
          aria-label="Sphere style"
          onKeyDown={e => {
            const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (step === 0 && e.key !== "Home" && e.key !== "End") return;
            e.preventDefault();
            const n = SPHERE_STYLES.length;
            const next = SPHERE_STYLES[e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (SPHERE_STYLES.indexOf(style ?? SPHERE_STYLES[0]) + step + n) % n]!;
            onPick(next);
            e.currentTarget.querySelector<HTMLElement>(`[data-style="${next}"]`)?.focus();
          }}
        >
          {SPHERE_STYLES.map(s => (
            <button
              key={s}
              data-style={s}
              role="radio"
              aria-checked={s === style}
              tabIndex={s === (style ?? SPHERE_STYLES[0]) ? 0 : -1}
              aria-label={STYLE_LABELS[s]}
              title={STYLE_LABELS[s]}
              className="group flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              onClick={() => onPick(s)}
            >
              <span
                className={`h-6 w-6 rounded-full transition-[box-shadow,transform,opacity] duration-200 group-active:scale-90 ${s === style ? "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"}`}
                style={{ background: STYLE_SWATCHES[s] }}
              />
            </button>
          ))}
        </div>
        <button
          ref={toggle}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:text-foreground active:scale-95 ${tuning ? "bg-muted/70 text-foreground" : "text-muted-foreground"}`}
          aria-label="Tune the sphere"
          aria-expanded={tuning}
          title="Tune the sphere"
          onClick={() => props.onTuning(!tuning)}
        >
          <Icon name="sliders" size={18} />
        </button>
      </div>
      <div className="text-center text-xs font-medium" aria-live="polite">
        {STYLE_LABELS[style ?? SPHERE_STYLES[0]]}
      </div>
      <div className="mt-1 max-w-64 text-center text-[11px] text-muted-foreground">
        {style ? INTERACTION_HINTS[VISUALS[style].interaction] : ""}
      </div>
      {props.error && <div role="status" className="mt-1 max-w-64 text-center text-xs text-destructive">Couldn't save style: {props.error}</div>}
    </div>
  );
}

/** The compact tuning panel: the current style's controls, applied live and saved to the plugin settings. */
function TunePanel(props: {
  style: SphereStyle;
  tune: Tune;
  onTune: (patch: TunePatch) => void;
  /** Why the last save failed, if it did. */
  error: string | null;
  opens: "below" | "right";
  root: React.RefObject<HTMLDivElement | null>;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { onClose, root, anchor, opens } = props;
  // Placed in the page's coordinates next to the tune button, kept inside the page.
  const [at, setAt] = useState<{ left: number; top: number; maxHeight: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = root.current?.getBoundingClientRect(), a = anchor.current?.getBoundingClientRect(), p = panel.current;
      if (r === undefined || a === undefined || p === null) return;
      const m = 12;
      const viewport = window.visualViewport;
      const visibleTop = Math.max(r.top, viewport?.offsetTop ?? 0);
      const visibleBottom = Math.min(r.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) - 64;
      const maxHeight = Math.max(44, visibleBottom - visibleTop - m * 2);
      const width = Math.max(44, Math.min(340, r.width - m * 2, window.innerWidth - m * 2));
      const w = width, h = Math.min(p.offsetHeight, maxHeight);
      const left = opens === "below" ? a.left + a.width / 2 - w / 2 - r.left : a.right + m - r.left;
      const top = opens === "below" ? a.bottom + 4 - r.top : a.bottom - h - r.top;
      // Keep the controls clear of the host's floating action button.
      setAt({ left: Math.max(m, Math.min(left, r.width - w - m)), top: Math.max(visibleTop - r.top + m, Math.min(top, visibleBottom - r.top - h - m)), maxHeight, width });
    };
    place();
    const ro = new ResizeObserver(place);
    if (root.current !== null) ro.observe(root.current);
    if (anchor.current !== null) ro.observe(anchor.current);
    if (panel.current !== null) ro.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [root, anchor, opens, props.style]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const away = (e: PointerEvent) => {
      const el = panel.current;
      // a tap outside closes it; the toggle button handles its own taps
      const t = e.target as Node;
      if (el !== null && !el.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", away);
    return () => (document.removeEventListener("keydown", key), document.removeEventListener("pointerdown", away));
  }, [onClose, anchor]);
  useEffect(() => {
    const el = panel.current;
    if (el === null) return;
    el.querySelector("input")?.focus({ preventScroll: true });
    if (!reducedMotion()) el.animate([{ opacity: 0, scale: "0.96" }, { opacity: 1, scale: "1" }], { duration: 200, easing: EASE });
    // closed with the keyboard (or a tap inside): focus goes back to the tune button
    return () => {
      if (el.contains(document.activeElement) || document.activeElement === document.body) anchor.current?.focus({ preventScroll: true });
    };
  }, [anchor]);
  const controls = controlsFor(props.style);
  const knobs = knobsFor(props.style);
  const changed = knobs.some(k => props.tune[k] !== controls[k]!.default);
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={`Tune ${STYLE_LABELS[props.style]}`}
      className="absolute z-30 flex max-h-[80vh] flex-col overflow-hidden w-[min(340px,calc(100vw-32px))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ left: at?.left ?? 0, top: at?.top ?? 0, maxHeight: at?.maxHeight, width: at?.width, visibility: at === null ? "hidden" : "visible" }}
    >
      <div className="-mt-2 flex shrink-0 items-center justify-between">
        <div className="text-xs font-medium">{STYLE_LABELS[props.style]}</div>
        <div className="flex items-center">
          <button
            className="h-11 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            disabled={!changed}
            onClick={() => props.onTune(Object.fromEntries(knobs.map(k => [k, null])))}
          >
            Reset
          </button>
          <button className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" aria-label="Close visual controls" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
      {knobs.map((k, index) => {
        const r = controls[k]!;
        const id = `vc-tune-${k}`;
        return (
          <div key={k}>
          {(index === 0 || (k in VISUALS[props.style].knobs && !(knobs[index - 1]! in VISUALS[props.style].knobs))) && <div className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{index === 0 ? "Look" : "Material & interaction"}</div>}
          <div className="flex min-h-11 items-center gap-2">
            <label htmlFor={id} className="w-24 shrink-0 text-xs text-muted-foreground">
              {r.label}
            </label>
            <input
              id={id}
              type="range"
              min={r.min}
              max={r.max}
              step={r.step}
              value={props.tune[k] ?? r.default}
              aria-valuetext={r.unit ? `${props.tune[k] ?? r.default} ${r.unit}` : formatKnob(k, props.tune[k] ?? r.default, props.style)}
              onChange={e => props.onTune({ [k]: Number(e.target.value) })}
              onDoubleClick={() => props.onTune({ [k]: null })}
              className="h-11 min-w-0 flex-1 cursor-pointer accent-foreground"
              style={k === "hue" ? { accentColor: `hsl(${props.tune.hue + 330} 80% 60%)` } : undefined}
            />
            <button type="button" className="min-h-11 w-11 shrink-0 rounded text-right text-xs tabular-nums text-muted-foreground hover:text-foreground disabled:opacity-50" title={`Reset ${r.label}`} aria-label={`Reset ${r.label}; current value ${formatKnob(k, props.tune[k] ?? r.default, props.style)}`} disabled={(props.tune[k] ?? r.default) === r.default} onClick={() => props.onTune({ [k]: null })}>{formatKnob(k, props.tune[k] ?? r.default, props.style)}</button>
          </div>
          </div>
        );
      })}
      </div>
      <div className="shrink-0 border-t border-border pt-2">
      {props.error !== null && (
        <div className="mt-1 text-xs text-destructive" role="alert">
          Couldn't save these settings: {props.error}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">Drag to preview · tap a value to reset.<br />Changes save automatically.</div>
      </div>
    </div>
  );
}

function Conversation(props: {
  threadId: string | null | undefined;
  hasContent: boolean;
  /** Edge to edge, like bb's own thread pages on a phone. */
  flush: boolean;
  /** During a call the transcript shows without its composer: the call is the input. */
  inCall: boolean;
  touch: boolean;
  onSent: () => void;
  onRenewed: (id: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [renewing, setRenewing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { threadId, hasContent, flush } = props;
  useEffect(() => {
    setTyping(false);
  }, [threadId]);
  const chat = useRef<HTMLDivElement>(null);
  useStickToEnd(chat, `${threadId}:${props.inCall}`);
  const say = (text: string) => {
    setFailure(null);
    props.onSent();
    rpc.call("say", { text }).catch(e => setFailure(message(e)));
  };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Conversation">
      <div className={`flex h-11 shrink-0 items-center justify-between text-xs text-muted-foreground ${flush ? "px-4" : ""}`}>
        <span className="font-medium">Conversation</span>
        {threadId !== undefined && threadId !== null && !props.inCall && hasContent && (
          <button
            className={`-mr-2 flex items-center gap-1.5 rounded-full px-3 hover:bg-muted/60 disabled:opacity-40 ${props.touch ? "h-11" : "h-8"}`}
            disabled={renewing}
            title="Start over in a new thread; this one stays in your threads"
            onClick={() => {
              setRenewing(true);
              rpc.call("newThread").then(
                r => (props.onRenewed(r.threadId), setRenewing(false)),
                e => (setFailure(message(e)), setRenewing(false)),
              );
            }}
          >
            <Icon name="plus" size={14} />
            {renewing ? "Starting…" : "New conversation"}
          </button>
        )}
      </div>
      {failure !== null && <div className={`pb-1 text-xs text-red-500 ${flush ? "px-4" : ""}`}>{failure}</div>}
      <div className={`min-h-0 flex-1 overflow-hidden ${flush ? "border-t border-border" : "rounded-2xl border border-border"}`}>
        {threadId === undefined ? (
          <div className="flex h-full flex-col gap-2 p-4" aria-label="Loading the conversation">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : threadId === null ? (
          <div className="p-4 text-xs leading-relaxed text-muted-foreground">
            bb has no Personal project, so the concierge talks without a thread of its own and nothing is kept here.
          </div>
        ) : !hasContent && !typing ? (
          <div className="flex h-full overflow-auto p-4">
            <div className="m-auto flex w-full max-w-sm flex-col gap-2">
              <div className="text-[15px] font-medium">Start a conversation</div>
              <div className="pb-1 text-xs text-muted-foreground">Tap Talk, or try one of these.</div>
              {SUGGESTIONS.map(s => (
                <button key={s} className="flex h-11 items-center rounded-xl border border-border px-3 text-left text-[13px] hover:bg-muted/60" onClick={() => say(s)}>
                  {s}
                </button>
              ))}
              <button className="flex h-11 items-center gap-2 rounded-xl px-3 text-left text-[13px] text-muted-foreground hover:bg-muted/60" onClick={() => setTyping(true)}>
                <Icon name="keyboard" size={16} />
                Type instead
              </button>
            </div>
          </div>
        ) : (
          <div
            ref={chat}
            className="h-full"
            style={{ maskImage: "linear-gradient(to bottom, transparent, #000 16px)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 16px)" }}
          >
            <ThreadChat threadId={threadId} variant={props.inCall ? "timeline" : "compact"} />
          </div>
        )}
      </div>
    </section>
  );
}

const ICONS: Record<string, string> = {
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  "mic-off": "M2 2l20 20M18.89 13.23A7 7 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M15 9.34V5a3 3 0 0 0-5.68-1.33M9 9v3a3 3 0 0 0 5.12 2.12M12 19v3",
  "phone-off":
    "M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91M22 2 2 22",
  plus: "M12 5v14M5 12h14",
  refresh: "M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5",
  x: "M18 6 6 18M6 6l12 12",
  alert: "M12 8v4M12 16h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
  minimize: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  spinner: "M21 12a9 9 0 1 1-6.22-8.56",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  copy: "M8 8h12v12H8zM4 16V4h12",
  check: "M20 6 9 17l-5-5",
  keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  /** Bring the call here: an arrow into a tray. */
  "move-here": "M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
};

/** Line icons in the style of bb's own (24-grid, 2px round strokes). */
function Icon({ name, size = 16, className = "" }: { name: keyof typeof ICONS; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {name === "spinner" && <circle cx="12" cy="12" r="9" opacity="0.25" />}
      <path d={ICONS[name]} />
    </svg>
  );
}

// ------------------------------------------------------------------ overlay: live signals, the floating mic, the pill

/** True while the on-screen keyboard is up (the visible viewport is much shorter than the window). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (vv === null || vv === undefined) return;
    const on = () => setOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", on);
    return () => vv.removeEventListener("resize", on);
  }, []);
  return open;
}

/** True on phone-width viewports. */
function useCompact(): boolean {
  const query = "(max-width: 640px), (max-height: 500px)";
  const [compact, setCompact] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const q = matchMedia(query);
    const on = () => setCompact(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return compact;
}

function LiveOverlay() {
  const call = useCall();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const { threadId: focused } = useBbContext();
  useEffect(() => {
    anywhere.rpc = rpc;
    anywhere.open = () => navigate.toPluginPanel(PAGE);
  }, [rpc, navigate]);
  useEffect(() => {
    anywhere.threadId = focused;
  }, [focused]);
  const touch = useTouch();
  const compact = useCompact();
  const keyboard = useKeyboardOpen();
  const onPage = usePageOpen();
  const [quiet, setQuiet] = useState(false); // the edge tab fades back after a moment
  useEffect(() => {
    setQuiet(false);
    const t = setTimeout(() => setQuiet(true), 2500);
    return () => clearTimeout(t);
  }, [onPage, call.phase]);
  useRealtime(LIVE_CHANNEL, payload => calls.receive(payload as LiveSignal));
  if (call.phase === "idle" && call.error !== null && !onPage) {
    // A call started from a thread (or the shortcut) failed: say why where the person is, with the way to fix it.
    const { text } = friendlyError(call.error);
    return (
      <div
        role="alert"
        className="pointer-events-auto fixed z-50 flex max-w-[min(420px,calc(100vw-24px))] items-center gap-1 rounded-full border border-border bg-background/90 py-1 pl-3 pr-1 text-xs backdrop-blur"
        style={{
          boxShadow: "0 6px 20px rgb(0 0 0 / 0.45)",
          ...(compact
            ? { top: "calc(env(safe-area-inset-top) + 56px)", left: "50%", transform: "translateX(-50%)" }
            : { bottom: "calc(env(safe-area-inset-bottom) + 20px)", right: "84px" }),
        }}
      >
        <Icon name="alert" size={14} className="shrink-0 text-destructive" />
        <span className="min-w-0 truncate px-1">{text}</span>
        <button className="shrink-0 whitespace-nowrap rounded-full px-2 py-1.5 font-medium hover:bg-muted/60" onClick={() => (calls.clearError(), navigate.toPluginPanel(PAGE))}>
          Open
        </button>
        <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-muted/60" aria-label="Dismiss" onClick={() => calls.clearError()}>
          <Icon name="x" size={14} />
        </button>
      </div>
    );
  }
  if (call.phase === "idle") {
    // On a touch screen, a small tab on the right edge stays one tap away on every page: clear of the composer and
    // of the floating buttons in the bottom corner, hidden while typing and on the concierge's own page.
    if (!touch || onPage || keyboard) return null;
    return (
      <button
        className="pointer-events-auto fixed z-50 flex h-14 w-11 items-center justify-center rounded-l-2xl border border-r-0 border-border bg-background/80 text-foreground backdrop-blur active:bg-muted"
        style={{
          right: "env(safe-area-inset-right)",
          top: "58%",
          opacity: quiet ? 0.55 : 1,
          boxShadow: "0 6px 20px rgb(0 0 0 / 0.35)",
          transition: motion("opacity"),
        }}
        onPointerDown={() => setQuiet(false)}
        aria-label="Talk by voice (to the thread on screen, else the concierge)"
        onClick={talkOrHangUp}
      >
        <Icon name="mic" size={18} />
      </button>
    );
  }
  if (onPage) return null; // the page has the full controls
  const live = call.phase === "live";
  const text = !live ? (call.phase === "connecting" ? "Connecting…" : "Ending…") : call.activity !== null ? "Looking that up…" : call.muted ? "Muted" : "Listening";
  const target = call.target;
  // Pinned: the call stays with its thread while the person moves around; on another thread, one tap moves it there.
  const canMove = live && target !== null && target.threadId !== null && focused !== null && focused !== target.threadId;
  const openTarget = () => (target !== null && !target.concierge && target.threadId !== null ? navigate.toThread(target.threadId) : navigate.toPluginPanel(PAGE));
  return (
    <div
      className="pointer-events-auto fixed z-50 flex items-center gap-1 rounded-full border border-border bg-background/80 py-1 pl-3 pr-1 text-xs backdrop-blur"
      style={{
        boxShadow: "0 6px 20px rgb(0 0 0 / 0.45)",
        ...(compact
          ? { top: "calc(env(safe-area-inset-top) + 56px)", left: "50%", transform: "translateX(-50%)" }
          : { bottom: "calc(env(safe-area-inset-bottom) + 20px)", right: "84px" }),
      }}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${live ? (call.muted ? "bg-amber-500" : "animate-pulse bg-emerald-500") : "bg-muted-foreground"}`} />
      <button
        className="flex min-w-0 max-w-[min(320px,60vw)] items-center whitespace-nowrap px-1.5 py-1.5 font-medium hover:underline"
        onClick={openTarget}
        title={target === null || target.concierge ? "Open the Voice concierge" : `Talking to the thread “${target.title}”: open it`}
      >
        <span className="min-w-0 truncate">{answerer(target)}</span>
        <span className="shrink-0">&nbsp;· {text}</span>
      </button>
      {canMove && (
        <button
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 hover:bg-muted/60 ${compact ? "h-11" : "h-8"}`}
          title="Move the voice call to this thread"
          onClick={() => void calls.retarget(focused)}
        >
          <Icon name="move-here" size={14} />
          {!compact && <span>Move here</span>}
        </button>
      )}
      {live && (
        <button
          className={`flex items-center justify-center rounded-full hover:bg-muted/60 ${compact ? "h-11 w-11" : "h-8 w-8"} ${call.muted ? "text-amber-500" : ""}`}
          aria-label={call.muted ? "Unmute" : "Mute"}
          aria-pressed={call.muted}
          onClick={() => calls.toggleMute()}
        >
          <Icon name={call.muted ? "mic-off" : "mic"} />
        </button>
      )}
      <button className={`flex items-center justify-center rounded-full ${HANG_UP} ${compact ? "h-11 w-11" : "h-8 w-8"}`} aria-label="Hang up" onClick={() => void calls.stop()}>
        <Icon name="phone-off" />
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

/** What the header action reads for every thread on screen: the one call and how to start it. */
function useTalkData() {
  return { call: useCall(), rpc: useRpc<typeof rpcContract>() };
}

/**
 * Talk, in every thread's header (on a phone, at the top of its thread menu). Idle: start a call with this thread,
 * whose agent answers aloud. In a call with this thread: says it is listening, and hangs up. In a call with another
 * thread: moves the call here (calls stay pinned to their thread otherwise).
 */
function talkItem({ thread, data }: { thread: { id: string }; data: ReturnType<typeof useTalkData> }) {
  const { call, rpc } = data;
  const here = thread.id;
  if (call.phase === "connecting" && call.asked === here) {
    return { label: "Connecting…", detail: "Cancel the voice call", icon: ICON.phoneOff, variant: "destructive" as const, run: () => void calls.stop() };
  }
  if (call.phase === "live" && call.target?.threadId === here) {
    return { label: call.muted ? "Muted · Hang up" : "Listening · Hang up", detail: "This thread is on a voice call", icon: ICON.phoneOff, variant: "destructive" as const, run: () => void calls.stop() };
  }
  if (call.phase === "live" && call.target !== null && call.target.threadId !== null) {
    return { label: "Move call here", detail: `Now talking to ${answerer(call.target)}`, icon: ICON.moveHere, run: () => void calls.retarget(here) };
  }
  return {
    label: "Talk",
    detail: "Talk to this thread: its agent answers aloud",
    icon: ICON.mic,
    disabled: call.phase !== "idle",
    run: () => void calls.start(rpc, here),
  };
}

/** The plugin's own glyphs as app icons, for host-rendered surfaces (the header action). */
const ICON = { mic: "voice-concierge/mic", phoneOff: "voice-concierge/phone-off", moveHere: "voice-concierge/move-here" } as const;
const glyph = (name: keyof typeof ICONS) =>
  function Glyph({ className }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d={ICONS[name]} />
      </svg>
    );
  };

export default definePluginApp(app => {
  app.slots.navPanel({ id: PAGE, title: "Voice concierge", icon: "Mic", path: PAGE, component: ConciergePage });
  app.slots.experimental_appOverlay({ id: "live", component: LiveOverlay });
  // From anywhere: the command palette and a keyboard shortcut (rebindable), and one click in the sidebar footer.
  app.commands.register({ id: "talk", title: "Voice: talk to this thread (or the concierge) / hang up", defaultShortcut: { key: "m", mod: true, shift: true }, run: talkOrHangUp });
  app.slots.sidebarFooterAction({ id: "talk", title: "Talk by voice (to the thread on screen, else the concierge)", icon: "Mic", run: talkOrHangUp });
  // In every thread: talk to that thread.
  app.experimental_icons.register({ name: ICON.mic, component: glyph("mic") });
  app.experimental_icons.register({ name: ICON.phoneOff, component: glyph("phone-off") });
  app.experimental_icons.register({ name: ICON.moveHere, component: glyph("move-here") });
  app.slots.experimental_threadAction({ id: "talk", title: "Talk by voice", icon: ICON.mic, group: "voice", placement: "header", useData: useTalkData, item: talkItem });
});
