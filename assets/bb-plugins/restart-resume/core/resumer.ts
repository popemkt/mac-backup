// The resume loop over a port: read a thread's facts, ask the policy, claim the interruption, send.
// Every trigger (server start, host reconnect, a thread failing) lands here, so there is one path
// that resumes and one place that makes it idempotent.
import {
  anyTurnCompleted,
  boundaryOf,
  continuationText,
  decide,
  type Decision,
  type EventRow,
  type ResumeRecord,
  type Settings,
  TURN_BOUNDARY_TYPES,
} from "./policy.ts";

/** A thread as the resumer reads it. Times are epoch ms. */
export interface ThreadSummary {
  readonly id: string;
  readonly status: string;
  readonly archivedAt: number | null;
  readonly updatedAt: number;
}

export interface EventQuery {
  readonly types: readonly [string, ...string[]];
  readonly order: "asc" | "desc";
  readonly limit: number;
  readonly afterSeq?: number;
}

/** What the resumer needs from bb. server.ts binds it to the plugin SDK; tests bind a fake. */
export interface ResumePort {
  settings(): Promise<Settings>;
  /** Threads updated at or after `since`, hidden ones included. */
  recentThreads(since: number): Promise<readonly ThreadSummary[]>;
  events(threadId: string, query: EventQuery): Promise<readonly EventRow[]>;
  loadRecord(threadId: string): Promise<ResumeRecord | null>;
  saveRecord(threadId: string, record: ResumeRecord): Promise<void>;
  send(threadId: string, text: string): Promise<void>;
  now(): number;
  log(level: "info" | "warn", message: string): void;
}

export interface Resumer {
  /** Consider one thread, e.g. the one a `thread.failed` event names. */
  consider(thread: ThreadSummary): Promise<Decision | null>;
  /** Consider every thread that failed inside the window. */
  sweep(): Promise<void>;
}

export function createResumer(port: ResumePort): Resumer {
  // Two triggers can name the same thread at once (a failure event during a sweep): one wins,
  // the other sees `null`. Across reloads the stored claim (interruptionSeq) is the guard.
  const inFlight = new Set<string>();

  async function decideFor(thread: ThreadSummary, settings: Settings): Promise<Decision> {
    const record = await port.loadRecord(thread.id);
    const [newest] = await port.events(thread.id, {
      types: TURN_BOUNDARY_TYPES,
      order: "desc",
      limit: 1,
    });
    const completedSinceRecord =
      record === null
        ? false
        : anyTurnCompleted(
            await port.events(thread.id, {
              types: ["turn/completed"],
              order: "asc",
              limit: 200,
              afterSeq: record.interruptionSeq,
            }),
          );
    return decide(
      {
        status: thread.status,
        archived: thread.archivedAt !== null,
        boundary: boundaryOf(newest),
        completedSinceRecord,
      },
      record,
      settings,
      port.now(),
    );
  }

  async function considerWith(thread: ThreadSummary, settings: Settings): Promise<Decision | null> {
    if (inFlight.has(thread.id)) return null;
    inFlight.add(thread.id);
    try {
      const decision = await decideFor(thread, settings);
      if (decision.action === "skip") {
        if (decision.reason === "cap-reached") {
          port.log(
            "info",
            `${thread.id}: interrupted by a restart again, not resumed: ${settings.maxConsecutive} resumes in a row without a completed turn`,
          );
        }
        return decision;
      }
      // Claim before sending, so a failed or slow send never leads to a second message.
      await port.saveRecord(thread.id, decision.record);
      try {
        await port.send(thread.id, continuationText(settings, decision.record));
        port.log(
          "info",
          `${thread.id}: auto-resumed after restart (${decision.record.chain} of ${settings.maxConsecutive}, interruption #${decision.record.interruptionSeq})`,
        );
      } catch (error) {
        port.log(
          "warn",
          `${thread.id}: auto-resume failed and will not be retried for this interruption: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return decision;
    } finally {
      inFlight.delete(thread.id);
    }
  }

  return {
    async consider(thread) {
      return considerWith(thread, await port.settings());
    },
    async sweep() {
      const settings = await port.settings();
      if (!settings.enabled) return;
      const since = port.now() - settings.windowMs;
      for (const thread of await port.recentThreads(since)) {
        if (thread.status !== "error" || thread.archivedAt !== null) continue;
        try {
          await considerWith(thread, settings);
        } catch (error) {
          port.log("warn", `${thread.id}: could not check for a restart interruption: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  };
}
