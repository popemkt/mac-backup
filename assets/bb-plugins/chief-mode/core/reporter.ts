// Automatic report-up: when an architect or project chief goes idle, its final assistant text is
// sent to the thread in its `reportsTo`. Guards, in order:
//   - debounce: a turn that ends and another that starts right after (a queued message, a steer)
//     report once, with the last text, after the thread has stayed idle for the window;
//   - the role, the per-role setting and the thread's own `autoReport`;
//   - no cycle in the reportsTo chain (a report into a cycle would bounce forever);
//   - a manual cm_report_up in that turn replaces the automatic one;
//   - the same text is never sent twice in a row;
//   - a rate cap per thread per hour, so two agents answering each other cannot run away.
import { type RoleMeta, ROLE_LABEL, wouldCycle } from "./model.ts";

export interface ReportSettings {
  enabled: boolean;
  debounceMs: number;
  maxPerHour: number;
  architects: boolean;
  projectChiefs: boolean;
}

export interface ReportRecord {
  lastHash: string | null;
  sentAt: number[];
  suppressNext: boolean;
}

export interface ReportPort {
  settings(): Promise<ReportSettings>;
  meta(threadId: string): Promise<RoleMeta | null>;
  title(threadId: string): Promise<string>;
  /** The cached reportsTo of any thread, for the cycle check. */
  reportsToOf(threadId: string): string | null;
  send(to: string, from: string, text: string): Promise<void>;
  loadRecord(threadId: string): Promise<ReportRecord | null>;
  saveRecord(threadId: string, record: ReportRecord): Promise<void>;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  log(level: "info" | "warn", message: string): void;
}

export type ReportOutcome =
  | "sent"
  | "disabled"
  | "no-role"
  | "no-target"
  | "empty"
  | "cycle"
  | "manual"
  | "duplicate"
  | "rate-limited"
  | "failed";

const HOUR = 3_600_000;
export const REPORT_MAX_CHARS = 6_000;

/** FNV-1a, enough to tell two texts apart without storing them. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export function formatReport(meta: RoleMeta, fromId: string, fromTitle: string, text: string, manual: boolean): string {
  const body = text.length > REPORT_MAX_CHARS ? `${text.slice(0, REPORT_MAX_CHARS)}\n… (truncated; read the thread for the rest)` : text;
  const task = meta.taskKey === null ? "" : ` for ${meta.taskKey}`;
  const how = manual ? "reports" : "finished a turn";
  return `[chief-mode report] ${ROLE_LABEL[meta.role]} ${JSON.stringify(fromTitle)} (${fromId})${task} ${how}:\n\n${body}`;
}

const emptyRecord = (): ReportRecord => ({ lastHash: null, sentAt: [], suppressNext: false });

export function createReporter(port: ReportPort) {
  const timers = new Map<string, unknown>();
  // One flush or manual report at a time per thread, so a record is never read twice before a write.
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T>(threadId: string, work: () => Promise<T>): Promise<T> => {
    const previous = chains.get(threadId) ?? Promise.resolve();
    const next = previous.then(work, work);
    chains.set(
      threadId,
      next.catch(() => undefined),
    );
    return next;
  };

  const cancel = (threadId: string): void => {
    const handle = timers.get(threadId);
    if (handle !== undefined) port.clearTimer(handle);
    timers.delete(threadId);
  };

  async function flush(threadId: string, text: string): Promise<ReportOutcome> {
    const settings = await port.settings();
    if (!settings.enabled) return "disabled";
    const meta = await port.meta(threadId);
    if (meta === null || meta.role === "coordinator") return "no-role";
    if (meta.role === "architect" && !settings.architects) return "disabled";
    if (meta.role === "project-chief" && !settings.projectChiefs) return "disabled";
    if (!meta.autoReport) return "disabled";
    if (meta.reportsTo === null) return "no-target";
    const trimmed = text.trim();
    if (trimmed === "") return "empty";
    if (wouldCycle(threadId, meta.reportsTo, port.reportsToOf)) {
      port.log("warn", `report from ${threadId} skipped: its reportsTo chain loops back to it`);
      return "cycle";
    }
    const record = (await port.loadRecord(threadId)) ?? emptyRecord();
    const now = port.now();
    record.sentAt = record.sentAt.filter((at) => now - at < HOUR);
    if (record.suppressNext) {
      record.suppressNext = false;
      await port.saveRecord(threadId, record);
      return "manual";
    }
    const hash = hashText(trimmed);
    if (record.lastHash === hash) return "duplicate";
    if (record.sentAt.length >= settings.maxPerHour) {
      port.log("warn", `report from ${threadId} skipped: ${settings.maxPerHour} reports in the last hour`);
      return "rate-limited";
    }
    const title = await port.title(threadId);
    try {
      await port.send(meta.reportsTo, threadId, formatReport(meta, threadId, title, trimmed, false));
    } catch (error) {
      port.log("warn", `report from ${threadId} to ${meta.reportsTo} failed: ${error instanceof Error ? error.message : String(error)}`);
      return "failed";
    }
    record.lastHash = hash;
    record.sentAt.push(now);
    await port.saveRecord(threadId, record);
    port.log("info", `reported ${threadId} → ${meta.reportsTo}`);
    return "sent";
  }

  return {
    /** A thread went idle with this final text: report it after the debounce window. */
    async onIdle(threadId: string, text: string | null): Promise<void> {
      cancel(threadId);
      if (text === null || text.trim() === "") return;
      const settings = await port.settings();
      if (!settings.enabled) return;
      const handle = port.setTimer(() => {
        timers.delete(threadId);
        void serial(threadId, () => flush(threadId, text));
      }, settings.debounceMs);
      timers.set(threadId, handle);
    },
    /** The thread started another turn before the window closed: its next idle reports instead. */
    onActive(threadId: string): void {
      cancel(threadId);
    },
    /** Flush now, bypassing the timer (tests and the CLI). */
    flushNow(threadId: string, text: string): Promise<ReportOutcome> {
      cancel(threadId);
      return serial(threadId, () => flush(threadId, text));
    },
    /**
     * Send a report the agent wrote itself (cm_report_up). It counts toward the rate cap and makes
     * the automatic report of the same turn stand down.
     */
    manual(threadId: string, text: string): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
      return serial(threadId, async () => {
        const meta = await port.meta(threadId);
        if (meta === null) return { ok: false as const, reason: "this thread has no chief-mode role" };
        if (meta.reportsTo === null) return { ok: false as const, reason: "this thread reports to no one (set --reports-to when adopting)" };
        if (wouldCycle(threadId, meta.reportsTo, port.reportsToOf)) return { ok: false as const, reason: "the reportsTo chain loops back to this thread" };
        const settings = await port.settings();
        const record = (await port.loadRecord(threadId)) ?? emptyRecord();
        const now = port.now();
        record.sentAt = record.sentAt.filter((at) => now - at < HOUR);
        if (record.sentAt.length >= settings.maxPerHour * 2) return { ok: false as const, reason: "too many reports in the last hour" };
        const title = await port.title(threadId);
        await port.send(meta.reportsTo, threadId, formatReport(meta, threadId, title, text.trim(), true));
        record.sentAt.push(now);
        record.lastHash = hashText(text.trim());
        record.suppressNext = true;
        await port.saveRecord(threadId, record);
        return { ok: true as const, to: meta.reportsTo };
      });
    },
    pendingCount(): number {
      return timers.size;
    },
    dispose(): void {
      for (const handle of timers.values()) port.clearTimer(handle);
      timers.clear();
    },
  };
}

export type Reporter = ReturnType<typeof createReporter>;
