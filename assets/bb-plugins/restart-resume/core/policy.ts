// The resume policy, pure: which interrupted thread gets a continuation, how many in a row, and
// what it says. No bb imports; the adapter (server.ts) feeds it facts read through the SDK.

/**
 * The one interruption reason bb gives when a thread's machine stopped carrying its turn: the
 * host daemon came back as a new process, or (with cause `host-connection-lost`) came back
 * without the turn. bb 0.46.1 stores it as the `reason` of a `system/thread/interrupted` event.
 * `manual-stop` (a user or agent stopped it), `host-removed` and `provider-turn-idle` are
 * never resumed.
 */
export const RESTART_REASON = "host-daemon-restarted";

/** Event types that start, end or cut a turn; the newest of them says where a thread stands. */
export const TURN_BOUNDARY_TYPES = [
  "client/turn/requested",
  "turn/started",
  "turn/completed",
  "system/thread/interrupted",
] as const;

export interface Settings {
  readonly enabled: boolean;
  /** Only interruptions newer than this are resumed. */
  readonly windowMs: number;
  /** Resumes in a row without a turn completing in between. */
  readonly maxConsecutive: number;
  readonly message: string;
}

export const DEFAULTS = {
  enabled: true,
  windowMinutes: 30,
  maxConsecutive: 3,
  message:
    "bb restarted while you were working; your last turn was interrupted. Check where you were and continue.",
} as const;

const MINUTE_MS = 60_000;

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Stored settings are untrusted: anything missing or out of range falls back or is clamped. */
export function parseSettings(raw: Readonly<Record<string, unknown>>): Settings {
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
    windowMs: boundedInt(raw.windowMinutes, 1, 24 * 60, DEFAULTS.windowMinutes) * MINUTE_MS,
    maxConsecutive: boundedInt(raw.maxConsecutive, 1, 10, DEFAULTS.maxConsecutive),
    message: message.length > 0 ? message : DEFAULTS.message,
  };
}

/** A thread event as the policy reads it. `createdAt` is epoch ms. */
export interface EventRow {
  readonly seq: number;
  readonly type: string;
  readonly createdAt: number;
  readonly data: unknown;
}

/** Where a thread stands: cut by an interruption, or anything else. */
export type TurnBoundary =
  | { readonly kind: "interrupted"; readonly seq: number; readonly at: number; readonly reason: string }
  | { readonly kind: "other"; readonly seq: number };

function field(data: unknown, key: string): unknown {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>)[key] : undefined;
}

/** The newest turn-boundary event, as a boundary; null when the thread has none. */
export function boundaryOf(newest: EventRow | undefined): TurnBoundary | null {
  if (newest === undefined) return null;
  if (newest.type !== "system/thread/interrupted") return { kind: "other", seq: newest.seq };
  const reason = field(newest.data, "reason");
  return {
    kind: "interrupted",
    seq: newest.seq,
    at: newest.createdAt,
    reason: typeof reason === "string" ? reason : "unknown",
  };
}

/** Whether any of these `turn/completed` events ended its turn normally. */
export function anyTurnCompleted(rows: readonly EventRow[]): boolean {
  return rows.some((row) => row.type === "turn/completed" && field(row.data, "status") === "completed");
}

/** What the plugin remembers per thread, in its own storage. */
export interface ResumeRecord {
  /** Resumes in a row; reset by a turn that completes. */
  readonly chain: number;
  /** The interruption event this record last resumed: an interruption is resumed once. */
  readonly interruptionSeq: number;
  readonly resumedAt: number;
}

export function parseRecord(raw: unknown): ResumeRecord | null {
  const chain = field(raw, "chain");
  const interruptionSeq = field(raw, "interruptionSeq");
  const resumedAt = field(raw, "resumedAt");
  return typeof chain === "number" && typeof interruptionSeq === "number" && typeof resumedAt === "number"
    ? { chain, interruptionSeq, resumedAt }
    : null;
}

export interface ThreadFacts {
  /** bb's thread status; an interruption by a restart leaves it `error`. */
  readonly status: string;
  readonly archived: boolean;
  readonly boundary: TurnBoundary | null;
  /** A turn completed normally after the interruption the record last resumed. */
  readonly completedSinceRecord: boolean;
}

export type SkipReason =
  | "disabled"
  | "archived"
  | "not-failed"
  | "not-interrupted"
  | "not-a-restart"
  | "already-resumed"
  | "stale"
  | "cap-reached";

export type Decision =
  | { readonly action: "resume"; readonly record: ResumeRecord }
  | { readonly action: "skip"; readonly reason: SkipReason };

export function decide(
  facts: ThreadFacts,
  record: ResumeRecord | null,
  settings: Settings,
  now: number,
): Decision {
  const skip = (reason: SkipReason): Decision => ({ action: "skip", reason });
  if (!settings.enabled) return skip("disabled");
  if (facts.archived) return skip("archived");
  if (facts.status !== "error") return skip("not-failed");
  const boundary = facts.boundary;
  if (boundary === null || boundary.kind !== "interrupted") return skip("not-interrupted");
  if (boundary.reason !== RESTART_REASON) return skip("not-a-restart");
  if (record !== null && record.interruptionSeq >= boundary.seq) return skip("already-resumed");
  if (now - boundary.at > settings.windowMs) return skip("stale");
  const chain = record !== null && !facts.completedSinceRecord ? record.chain : 0;
  if (chain >= settings.maxConsecutive) return skip("cap-reached");
  return { action: "resume", record: { chain: chain + 1, interruptionSeq: boundary.seq, resumedAt: now } };
}

/** The message a resumed thread gets: the configured text, marked so the person sees what sent it. */
export function continuationText(settings: Settings, record: ResumeRecord): string {
  return `${settings.message}\n\n(auto-resumed after restart, ${record.chain} of ${settings.maxConsecutive})`;
}
