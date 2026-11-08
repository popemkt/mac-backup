// Which bb thread a call talks to. A call started from a thread talks to that thread: its requests are relayed to it
// and its agent's replies are spoken. Started anywhere else, it talks to the concierge's own thread. The call stays
// pinned to its thread while the person moves around bb, until they move it (`retarget`). The server keeps one record
// per live call; the call's relay (`bb voice-concierge ask --call <id>`) reads it on every request.
import { ASK_TIMEOUT_MS, relay, type ThreadStatus, voiceMessage } from "./concierge-thread.ts";

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
    ask(text: string): Promise<string>;
  };
  store: {
    get(conversationId: string): Promise<CallTarget | null>;
    set(conversationId: string, target: CallTarget): Promise<void>;
    delete(conversationId: string): Promise<void>;
  };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class CallTargets {
  private readonly deps: CallTargetDeps;

  constructor(deps: CallTargetDeps) {
    this.deps = deps;
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

  started(conversationId: string, target: CallTarget): Promise<void> {
    return this.deps.store.set(conversationId, target);
  }

  ended(conversationId: string): Promise<void> {
    return this.deps.store.delete(conversationId);
  }

  /** Move a live call to another thread (null: the concierge's own). */
  async retarget(conversationId: string, threadId: string | null): Promise<CallTarget> {
    const before = await this.deps.store.get(conversationId);
    if (before === null) throw new Error("That voice call is not live");
    // A call that started with nothing to relay to has a backing agent that works on its own: it cannot move.
    if (before.threadId === null) throw new Error("This call has no thread to relay to, so it cannot move.");
    const to = await this.resolve(threadId);
    if (to.threadId === null) throw new Error("bb has no Personal project for the concierge's thread.");
    await this.deps.store.set(conversationId, to);
    return to;
  }

  /**
   * A request relayed from a call (`conversationId`), or from the CLI without one: to the call's thread, or the
   * concierge's. The concierge's thread is briefed and answers quickly, so a request waits for its current turn; a work
   * thread may be mid-turn for many minutes, so a request is queued behind it and the call is told so.
   */
  async ask(text: string, conversationId: string | null): Promise<string> {
    const t = conversationId === null ? null : await this.deps.store.get(conversationId);
    // A call id that is not on record never falls back to the concierge: that could answer for the wrong thread.
    if (conversationId !== null && t === null) throw new Error("That voice call is not live, or its thread is not on record.");
    if (t === null || t.concierge || t.threadId === null) return this.deps.concierge.ask(text);
    const threads = this.deps.threads;
    return relay(
      { status: async id => (await threads.info(id))?.status ?? null, send: threads.send, output: threads.output },
      t.threadId,
      voiceMessage(text),
      {
        busy: "queue",
        timeoutMs: ASK_TIMEOUT_MS,
        late: LATE_REPLY,
        sleep: this.deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms))),
        now: this.deps.now ?? Date.now,
      },
    );
  }
}
