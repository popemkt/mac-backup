// The concierge's own bb thread: one ordinary bb thread, created by the plugin and marked as the concierge's in its
// plugin metadata. It is the conversation: the voice call relays each request to it (`bb voice-concierge ask`) and
// speaks the reply, and the owner can continue it by typing anywhere bb shows it.
import { THREAD_BRIEF } from "./persona.ts";

export type ThreadStatus = "idle" | "pending" | "starting" | "active" | "stopping" | "error" | string;

export interface ConciergeThreadsApi {
  /** The thread's status, or null when it no longer exists or is archived. */
  status(threadId: string): Promise<ThreadStatus | null>;
  spawn(input: { projectId: string; hostId: string | null; brief: string }): Promise<string>;
  send(threadId: string, text: string): Promise<void>;
  output(threadId: string): Promise<string | null>;
}

export interface ConciergeThreadDeps {
  threads: ConciergeThreadsApi;
  store: { get(): Promise<string | null>; set(threadId: string): Promise<void> };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const BUSY = new Set(["pending", "starting", "active", "stopping"]);
const POLL_MS = 300;

/** Whether a thread's last answer is still the reply to its brief: nothing has been said in it yet. */
export function isFresh(output: string | null): boolean {
  return output === null || /^ready\.?$/i.test(output.trim());
}

/** Marks a relayed request so the thread answers it for speech (see THREAD_BRIEF). */
export const VOICE_PREFIX = "[voice] ";

export class ConciergeThread {
  private readonly deps: ConciergeThreadDeps;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private creating: Promise<string> | null = null;

  constructor(deps: ConciergeThreadDeps) {
    this.deps = deps;
    this.sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  /** The thread id if it exists (not archived or deleted), else null. */
  async current(): Promise<string | null> {
    const id = await this.deps.store.get();
    if (id === null) return null;
    return (await this.deps.threads.status(id)) === null ? null : id;
  }

  /** The thread, created in `projectId` the first time (or after it was archived or deleted). */
  async ensure(projectId: string | null, hostId: string | null): Promise<string> {
    const id = await this.current();
    if (id !== null) return id;
    if (projectId === null) throw new Error("No project for the concierge's thread");
    this.creating ??= this.deps.threads
      .spawn({ projectId, hostId, brief: THREAD_BRIEF })
      .then(async created => {
        await this.deps.store.set(created);
        return created;
      })
      .finally(() => {
        this.creating = null;
      });
    return this.creating;
  }

  /** Start a new conversation: a new thread becomes the concierge's; the previous one (returned) stays as it is. */
  async renew(projectId: string, hostId: string | null): Promise<{ threadId: string; previous: string | null }> {
    const previous = await this.current();
    const threadId = await this.deps.threads.spawn({ projectId, hostId, brief: THREAD_BRIEF });
    await this.deps.store.set(threadId);
    return { threadId, previous };
  }

  /**
   * Send one request and wait for the thread's reply: waits for any running turn to finish first (the owner may have
   * typed), then for the new turn to start and settle, and returns its final output.
   */
  async ask(text: string, timeoutMs = ASK_TIMEOUT_MS): Promise<string> {
    const id = await this.current();
    if (id === null) throw new Error("The concierge has no thread yet");
    return relay(this.deps.threads, id, `${VOICE_PREFIX}${text}`, { busy: "wait", timeoutMs, sleep: this.sleep, now: this.now });
  }
}

/** How long a relayed request may take: under the host's 150 s limit on `bb voice-concierge ask`, so it answers first. */
export const ASK_TIMEOUT_MS = 140_000;

export interface RelayOptions {
  /**
   * A thread already in a turn: "wait" for it to finish, then send (the concierge's own thread, whose turns are short);
   * "queue" the message behind it and answer at once (a work thread, whose turn may run for many minutes).
   */
  busy: "wait" | "queue";
  timeoutMs: number;
  /** Spoken in place of a reply that is not ready in time; null throws instead. */
  late?: string | null;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** What a queued request answers: the thread is mid-turn and will reply in the thread, not on the call. */
export const QUEUED_REPLY = "That thread is in the middle of a turn. I queued your message; it will answer in the thread when it gets to it.";

/**
 * Send `message` to a thread and return the reply of the turn it starts (its final output). See RelayOptions for a
 * thread that is already busy, and for a reply that does not come in time.
 */
export async function relay(threads: Pick<ConciergeThreadsApi, "status" | "send" | "output">, id: string, message: string, o: RelayOptions): Promise<string> {
  const deadline = o.now() + o.timeoutMs;
  for (;;) {
    const s = await threads.status(id);
    if (s === null) throw new Error("That thread is gone (archived or deleted)");
    if (!BUSY.has(s)) break;
    if (o.busy === "queue") {
      await threads.send(id, message);
      return QUEUED_REPLY;
    }
    if (o.now() > deadline) throw new Error("The thread is busy");
    await o.sleep(POLL_MS);
  }
  await threads.send(id, message);
  let started = false;
  const startBy = o.now() + 20_000;
  for (;;) {
    const s = await threads.status(id);
    if (s === null) throw new Error("That thread is gone (archived or deleted)");
    if (s === "error") throw new Error("The thread failed on that request");
    if (BUSY.has(s)) started = true;
    else if (started || o.now() > startBy) return (await threads.output(id)) ?? "(no answer)";
    if (o.now() > deadline) {
      if (o.late != null) return o.late;
      throw new Error("The thread is still working; ask again in a moment");
    }
    await o.sleep(POLL_MS);
  }
}

/** Wraps a request relayed into a work thread, whose agent has no brief: how to answer for speech, and rule 2. */
export function voiceMessage(request: string): string {
  return `${VOICE_PREFIX}${request}

(Relayed from a live voice call: your reply is spoken aloud. Answer in one or two plain sentences, the answer first, with no markdown, lists, ids or paths. If this asks you to change anything and does not end with "(confirmed)", do nothing yet and reply only with a one-line question to confirm.)
`;
}
