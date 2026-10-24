// The resume loop over a port: read a thread's facts, ask the policy, claim the interruption, send.
// Every trigger (server start, host reconnect, a thread failing) lands here, so there is one path
// that resumes and one place that makes it idempotent. It also answers why a thread stopped
// (`stop`), from the same facts and records, for the frontend's indicator.
import {
  anyTurnCompleted,
  boundaryOf,
  continuationText,
  decide,
  type Decision,
  type EventRow,
  INTERACTION_TYPES,
  parentCovers,
  RESTART_REASON,
  type ResumeRecord,
  type Settings,
  type SkipReason,
  TURN_BOUNDARY_TYPES,
  wasWaitingOnUser,
} from "./policy.ts";
import {
  type ResumeState,
  resumeStateOf,
  standingInterruption,
  STOP_EVENT_LIMIT,
  STOP_EVENT_TYPES,
  stopView,
  type StopView,
} from "./stops.ts";

/** A thread as the resumer reads it. Times are epoch ms. */
export interface ThreadSummary {
  readonly id: string;
  readonly status: string;
  readonly archivedAt: number | null;
  readonly updatedAt: number;
  readonly parentThreadId: string | null;
}

export interface EventQuery {
  readonly types: readonly [string, ...string[]];
  readonly order: "asc" | "desc";
  readonly limit: number;
  readonly afterSeq?: number;
  readonly beforeSeq?: number;
}

/** What the resumer needs from bb. server.ts binds it to the plugin SDK; tests bind a fake. */
export interface ResumePort {
  settings(): Promise<Settings>;
  /** Threads updated at or after `since`, hidden ones included. */
  recentThreads(since: number): Promise<readonly ThreadSummary[]>;
  /** One thread, or null when it is gone. */
  thread(threadId: string): Promise<ThreadSummary | null>;
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
  /**
   * Why the thread's latest turn stopped, if an interruption no later turn superseded ends it:
   * the interruption, and for a restart what this resumer did or would do about it. Read only.
   */
  stop(threadId: string): Promise<StopView | null>;
}

/** How far up a thread tree a child looks for a covering ancestor. */
const MAX_ANCESTORS = 8;

/** Skips worth a line in the plugin log: the person may wonder why this thread stayed stopped. */
const LOGGED_SKIPS: Partial<Record<SkipReason, (settings: Settings) => string>> = {
  "waiting-on-user": () => "not resumed: was waiting on user",
  "cap-reached": (settings) =>
    `not resumed: ${settings.maxConsecutive} resumes in a row without a completed turn`,
  "parent-resumes": () => "not resumed: its parent is resumed and re-drives it",
};

export function createResumer(port: ResumePort): Resumer {
  // Two triggers can name the same thread at once (a failure event during a sweep): one wins,
  // the other sees `null`. Across reloads the stored claim (interruptionSeq) is the guard.
  const inFlight = new Set<string>();

  /** The cut turn's interaction events: everything after the newest `turn/started` before `seq`. */
  async function waitingOnUser(threadId: string, interruptionSeq: number): Promise<boolean> {
    const [cutTurn] = await port.events(threadId, {
      types: ["turn/started"],
      order: "desc",
      limit: 1,
      beforeSeq: interruptionSeq,
    });
    return wasWaitingOnUser(
      await port.events(threadId, {
        types: INTERACTION_TYPES,
        order: "asc",
        limit: 200,
        ...(cutTurn === undefined ? {} : { afterSeq: cutTurn.seq }),
      }),
    );
  }

  async function covered(parentId: string | null, settings: Settings, depth: number): Promise<boolean> {
    if (parentId === null || depth >= MAX_ANCESTORS) return false;
    const parent = await port.thread(parentId);
    if (parent === null) return false;
    const { decision, record } = await decideFor(parent, settings, depth + 1);
    return parentCovers(decision, record, settings, port.now());
  }

  async function decideFor(
    thread: ThreadSummary,
    settings: Settings,
    depth = 0,
  ): Promise<{ decision: Decision; record: ResumeRecord | null }> {
    const record = await port.loadRecord(thread.id);
    const [newest] = await port.events(thread.id, { types: TURN_BOUNDARY_TYPES, order: "desc", limit: 1 });
    const boundary = boundaryOf(newest);
    const base = {
      status: thread.status,
      archived: thread.archivedAt !== null,
      boundary,
      completedSinceRecord: false,
      waitingOnUser: false,
      parentCovers: false,
    };
    // Cheap facts first: most threads are settled by them, before any further reads. Only the
    // cap depends on a fact not read yet (a completed turn resets it).
    const first = decide(base, record, settings, port.now());
    if (first.action === "skip" && first.reason !== "cap-reached") return { decision: first, record };
    const interruptionSeq = boundary?.seq ?? 0;
    const facts = {
      ...base,
      completedSinceRecord:
        record !== null &&
        anyTurnCompleted(
          await port.events(thread.id, {
            types: ["turn/completed"],
            order: "asc",
            limit: 200,
            afterSeq: record.interruptionSeq,
          }),
        ),
      waitingOnUser: await waitingOnUser(thread.id, interruptionSeq),
      parentCovers: await covered(thread.parentThreadId, settings, depth),
    };
    return { decision: decide(facts, record, settings, port.now()), record };
  }

  async function considerWith(thread: ThreadSummary, settings: Settings): Promise<Decision | null> {
    if (inFlight.has(thread.id)) return null;
    inFlight.add(thread.id);
    try {
      const { decision } = await decideFor(thread, settings);
      if (decision.action === "skip") {
        const line = LOGGED_SKIPS[decision.reason];
        if (line !== undefined) port.log("info", `${thread.id}: interrupted by a restart, ${line(settings)}`);
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
    async stop(threadId) {
      const rows = await port.events(threadId, { types: STOP_EVENT_TYPES, order: "desc", limit: STOP_EVENT_LIMIT });
      const interruption = standingInterruption(rows);
      if (interruption === null) return null;
      let resume: ResumeState = { kind: "none" };
      if (interruption.reason === RESTART_REASON) {
        const [settings, thread] = await Promise.all([port.settings(), port.thread(threadId)]);
        if (thread !== null) {
          const { decision, record } = await decideFor(thread, settings);
          resume = resumeStateOf(interruption, record, decision, settings.maxConsecutive);
        }
      }
      return stopView(threadId, interruption, resume);
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
          port.log(
            "warn",
            `${thread.id}: could not check for a restart interruption: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
  };
}
