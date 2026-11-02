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
  async ask(text: string, timeoutMs = 180_000): Promise<string> {
    const id = await this.current();
    if (id === null) throw new Error("The concierge has no thread yet");
    const deadline = this.now() + timeoutMs;
    await this.settle(id, deadline);
    await this.deps.threads.send(id, `${VOICE_PREFIX}${text}`);
    let started = false;
    const startBy = this.now() + 20_000;
    for (;;) {
      const s = await this.deps.threads.status(id);
      if (s === null) throw new Error("The concierge's thread is gone");
      if (s === "error") throw new Error("The concierge's thread failed on that request");
      if (BUSY.has(s)) started = true;
      else if (started || this.now() > startBy) return (await this.deps.threads.output(id)) ?? "(no answer)";
      if (this.now() > deadline) throw new Error("The concierge's thread is still working; ask again in a moment");
      await this.sleep(POLL_MS);
    }
  }

  private async settle(id: string, deadline: number): Promise<void> {
    for (;;) {
      const s = await this.deps.threads.status(id);
      if (s === null || !BUSY.has(s)) return;
      if (this.now() > deadline) throw new Error("The concierge's thread is busy");
      await this.sleep(POLL_MS);
    }
  }
}
