// restart-resume's backend: binds the resumer (core/resumer.ts) to bb and fires it from the three
// moments a restart interruption can surface. bb interrupts a thread when its host daemon's session
// opens again: as a new daemon process, or as the same one without the thread's turn. So:
//   - `thread.failed`: the interruption itself, as it is written;
//   - a host reconnecting (`host:changed` with `host-connected`): a sweep shortly after, for an
//     interruption whose event this plugin missed;
//   - the plugin starting (server start, reload, enable): a sweep for whatever happened while it
//     was not loaded.
// The plugin never looks at which process or unit restarted; it reacts to the interruption only.
//
// It also serves the "why this thread stopped" indicator: `stops` (RPC) answers from the resumer's
// own reads and records, and a `stops` realtime signal names a thread whose answer may have changed,
// so the frontend refetches it instead of polling.
import { type BbPluginApi, defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULTS, type EventRow, parseRecord, parseSettings } from "./core/policy.ts";
import { createResumer, type EventQuery, type ResumePort, type ThreadSummary } from "./core/resumer.ts";
import { STOPS_BATCH, STOPS_CHANNEL, type StopView } from "./core/stops.ts";

/** bb registers the daemon before it reconciles the daemon's threads; let that settle first. */
const RECONNECT_SWEEP_DELAY_MS = 5_000;
const LIST_PAGE = 200;
const LIST_MAX_PAGES = 25;

/** The SDK's event-type filter; its element type is not exported by name. */
type EventTypes = NonNullable<Parameters<BbPluginApi["sdk"]["threads"]["events"]["list"]>[0]["types"]>;

const recordKey = (threadId: string): string => `thread:${threadId}`;

/** Threads read at once inside one `stops` call. */
const STOPS_CONCURRENCY = 8;

// The view is built by core/stops.ts; the contract only checks its outer shape on the way out.
const stopView = z.custom<StopView>(
  (value) => typeof value === "object" && value !== null && typeof (value as { threadId?: unknown }).threadId === "string",
);

export const rpcContract = defineRpcContract({
  /** The standing stop of each thread, for those whose latest turn ended with an interruption. */
  stops: {
    input: z.object({ threadIds: z.array(z.string().min(1).max(200)).max(STOPS_BATCH) }).strict(),
    output: z.object({ stops: z.array(stopView), checked: z.array(z.string()) }),
  },
});

const summary = (thread: ThreadSummary): ThreadSummary => ({
  id: thread.id,
  status: thread.status,
  archivedAt: thread.archivedAt,
  updatedAt: thread.updatedAt,
  parentThreadId: thread.parentThreadId,
});

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Resume threads a restart interrupted",
      default: DEFAULTS.enabled,
    },
    windowMinutes: {
      type: "number",
      label: "Only resume interruptions newer than (minutes, 1 to 1440)",
      default: DEFAULTS.windowMinutes,
    },
    maxConsecutive: {
      type: "number",
      label: "Resumes in a row without a completed turn (1 to 10)",
      default: DEFAULTS.maxConsecutive,
    },
    message: {
      type: "string",
      label: "Continuation message",
      experimental_multiline: true,
      default: DEFAULTS.message,
    },
  });

  const port: ResumePort = {
    async settings() {
      return parseSettings(await settings.get());
    },
    async recentThreads(since) {
      const recent: ThreadSummary[] = [];
      for (let page = 0; page < LIST_MAX_PAGES; page++) {
        const rows = await bb.sdk.threads.list({ includeHidden: true, limit: LIST_PAGE, offset: page * LIST_PAGE });
        for (const row of rows) if (row.updatedAt >= since) recent.push(summary(row));
        if (rows.length < LIST_PAGE) break;
      }
      return recent;
    },
    async thread(threadId) {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        return thread.deletedAt === null ? summary(thread) : null;
      } catch {
        return null; // gone, or not readable: no parent to defer to
      }
    },
    async events(threadId, query: EventQuery) {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        // The policy names only event types bb 0.46.1 declares (TURN_BOUNDARY_TYPES,
        // INTERACTION_TYPES, turn/started, turn/completed).
        types: query.types as EventTypes,
        order: query.order,
        limit: String(query.limit),
        ...(query.afterSeq === undefined ? {} : { afterSeq: String(query.afterSeq) }),
        ...(query.beforeSeq === undefined ? {} : { beforeSeq: String(query.beforeSeq) }),
      });
      return rows.map((row): EventRow => ({ seq: row.seq, type: row.type, createdAt: row.createdAt, data: row.data }));
    },
    async loadRecord(threadId) {
      return parseRecord(await bb.storage.kv.get(recordKey(threadId)));
    },
    async saveRecord(threadId, record) {
      await bb.storage.kv.set(recordKey(threadId), record);
    },
    async send(threadId, text) {
      await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] });
    },
    now: () => Date.now(),
    log(level, message) {
      bb.log[level](message);
    },
  };
  const resumer = createResumer(port);

  const stopChanged = (threadId: string): void => bb.realtime.publish(STOPS_CHANNEL, { threadId });

  bb.rpc.register(rpcContract, {
    async stops({ threadIds }) {
      const stops: StopView[] = [];
      const checked: string[] = [];
      const queue = [...new Set(threadIds)];
      const worker = async (): Promise<void> => {
        for (let threadId = queue.shift(); threadId !== undefined; threadId = queue.shift()) {
          try {
            const stop = await resumer.stop(threadId);
            if (stop !== null) stops.push(stop);
            checked.push(threadId);
          } catch {
            // Gone or unreadable: leave it unchecked, so the frontend keeps what it had.
          }
        }
      };
      await Promise.all(Array.from({ length: STOPS_CONCURRENCY }, worker));
      return { stops, checked };
    },
  });

  bb.events.on("thread.failed", async ({ thread }) => {
    try {
      await resumer.consider(summary(thread));
    } finally {
      stopChanged(thread.id);
    }
  });
  // The other moments a thread's standing stop can change: a manual stop settles (idle), a resumed
  // or new turn starts (active), a turn completes (idle), the thread leaves the list.
  for (const event of ["thread.idle", "thread.active", "thread.archived", "thread.unarchived"] as const) {
    bb.events.on(event, ({ thread }) => stopChanged(thread.id));
  }
  bb.events.on("thread.deleted", async ({ thread }) => {
    await bb.storage.kv.delete(recordKey(thread.id));
    stopChanged(thread.id);
  });

  bb.background.service("watch", {
    async start(signal) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const sweep = (why: string): void => {
        resumer.sweep().catch((error: unknown) => {
          bb.log.warn(`sweep after ${why} failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      };
      const unsubscribe = bb.sdk.subscribe({
        event: "host:changed",
        callback(change) {
          if (!change.changes.includes("host-connected")) return;
          clearTimeout(timer);
          timer = setTimeout(() => sweep("a host reconnected"), RECONNECT_SWEEP_DELAY_MS);
        },
      });
      sweep("start");
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      clearTimeout(timer);
      unsubscribe();
    },
  });
}
