// Which bb thread a call talks to. A call started from a thread talks to that thread: its requests are relayed to it
// and its agent's replies are spoken. Started anywhere else, it talks to the concierge's own thread. The call stays
// pinned to the thread it recorded (even the concierge's: a new concierge conversation does not move a live call)
// until the person moves it (`retarget`). The record lives in the server's memory only: a call is routable from
// `started` until `ended` (hang-up or the call closing), and a server restart drops every record, so a call that
// outlives the server can no longer reach any thread. The call's relay (`bb voice-concierge ask --call <id>`) reads
// the record on every request.
import { ASK_TIMEOUT_MS, relay, type ThreadStatus, VOICE_PREFIX, voiceMessage } from "./concierge-thread.ts";

/** threadId is null only for the concierge when bb has no Personal project for its thread (the call cannot relay). */
export interface CallTarget {
  threadId: string | null;
  title: string;
  concierge: boolean;
}

export const CONCIERGE_TITLE = "Voice concierge";
/** Spoken when a work thread's turn outlasts the relay's time limit. */
export const LATE_REPLY = "It is still working on that; the full answer will be in the thread.";

export interface CallTargetDeps {
  threads: {
    /** Title and status, or null when the thread is gone or archived. */
    info(threadId: string): Promise<{ title: string | null; status: ThreadStatus } | null>;
    send(threadId: string, text: string): Promise<void>;
    output(threadId: string): Promise<string | null>;
  };
  concierge: {
    /** The concierge's thread if it exists, without creating it. */
    current(): Promise<string | null>;
    /** The concierge's thread, created if needed ("new": always a new one); null when bb has nowhere to put it. */
    ensure(mode: "reuse" | "new"): Promise<string | null>;
    /** A request from outside any call (the CLI): the concierge's current thread. */
    ask(text: string): Promise<string>;
  };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** One live call's record; replaced, never mutated, so a stale reference shows the record changed. */
interface Entry {
  readonly target: CallTarget;
}

export class CallTargets {
  private readonly deps: CallTargetDeps;
  private readonly calls = new Map<string, Entry>();
  /** Calls that closed before they were recorded (the close beat the start's answer), and when. */
  private readonly closedEarly = new Map<string, number>();
  private readonly clock: () => number;

  constructor(deps: CallTargetDeps) {
    this.deps = deps;
    this.clock = deps.now ?? Date.now;
  }

  /** The thread a call should talk to: `threadId` when it is a live thread other than the concierge's, else the concierge's. */
  async resolve(threadId: string | null, mode: "reuse" | "new" = "reuse"): Promise<CallTarget> {
    if (threadId !== null) {
      const t = await this.deps.threads.info(threadId);
      if (t === null) throw new Error("That thread is archived or gone, so the call cannot talk to it.");
      if (threadId !== (await this.deps.concierge.current())) return { threadId, title: t.title?.trim() || "Untitled thread", concierge: false };
    }
    const id = await this.deps.concierge.ensure(mode).catch(() => null);
    return { threadId: id, title: CONCIERGE_TITLE, concierge: true };
  }

  /**
   * Record a call that started at `since` (before the backend was asked). A call that already closed after that is
   * refused: it must not become routable, or look live to the page.
   */
  started(conversationId: string, target: CallTarget, since = -Infinity): void {
    const closedAt = this.closedEarly.get(conversationId);
    this.closedEarly.delete(conversationId);
    if (closedAt !== undefined && closedAt >= since) throw new Error("The call closed while it was connecting");
    this.calls.set(conversationId, { target });
  }

  /** The call is over (hung up or closed): from now on its relay is refused. */
  ended(conversationId: string): void {
    const now = this.clock();
    if (!this.calls.delete(conversationId)) this.closedEarly.set(conversationId, now);
    for (const [id, at] of this.closedEarly) if (now - at > 10 * 60_000) this.closedEarly.delete(id);
  }

  target(conversationId: string): CallTarget | null {
    return this.calls.get(conversationId)?.target ?? null;
  }

  /** Move a live call to another thread (null: the concierge's own). */
  async retarget(conversationId: string, threadId: string | null): Promise<CallTarget> {
    const before = this.calls.get(conversationId);
    if (before === undefined) throw new Error("That voice call is not live");
    // A call that started with nothing to relay to has a backing agent that works on its own: it cannot move.
    if (before.target.threadId === null) throw new Error("This call has no thread to relay to, so it cannot move.");
    const to = await this.resolve(threadId);
    if (to.threadId === null) throw new Error("bb has no Personal project for the concierge's thread.");
    // The call may have ended (or moved) while the thread was looked up: never bring a record back.
    if (this.calls.get(conversationId) !== before) throw new Error("That voice call ended or moved meanwhile");
    this.calls.set(conversationId, { target: to });
    return to;
  }

  /**
   * A request relayed from a call (`conversationId`), or from the CLI without one. A call's request goes to the thread
   * the call recorded, never to another: an id not on record is refused, and a recorded thread that is gone fails.
   * The concierge's thread is briefed and answers quickly, so a request waits for its current turn; a work thread may
   * be mid-turn for many minutes, so a request is queued behind it and the call is told so.
   */
  async ask(text: string, conversationId: string | null): Promise<string> {
    if (conversationId === null) return this.deps.concierge.ask(text);
    const entry = this.calls.get(conversationId);
    if (entry === undefined) throw new Error("That voice call is not live, or its thread is not on record.");
    const t = entry.target;
    // Hanging up or moving the call while this request waits withdraws it: it is never sent after that.
    const alive = () => this.calls.get(conversationId) === entry;
    if (t.threadId === null) throw new Error("This call has no thread to relay to.");
    const threads = this.deps.threads;
    const api = { status: async (id: string) => (await threads.info(id))?.status ?? null, send: threads.send, output: threads.output };
    const clock = { sleep: this.deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms))), now: this.deps.now ?? Date.now };
    return t.concierge
      ? relay(api, t.threadId, `${VOICE_PREFIX}${text}`, { busy: "wait", timeoutMs: ASK_TIMEOUT_MS, alive, ...clock })
      : relay(api, t.threadId, voiceMessage(text), { busy: "queue", timeoutMs: ASK_TIMEOUT_MS, late: LATE_REPLY, alive, ...clock });
  }
}
