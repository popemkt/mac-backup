// Why a thread stopped, pure: the newest interruption a later turn has not superseded, who or what
// caused it, and what the resume policy did about it. No bb imports: server.ts reads the facts and
// the frontend (app.tsx, adapter/) draws the result.
//
// bb 0.46.1 records an interruption as `system/thread/interrupted` with `data.reason` and an
// optional `data.cause`, nothing else: no actor. A manual stop from the UI, the CLI, or another
// agent's `bb thread stop` all write `reason: "manual-stop"` (README, "Who stopped it").
import { type Decision, type EventRow, RESTART_REASON, type ResumeRecord, type SkipReason } from "./policy.ts";

/** The realtime channel whose payload `{ threadId }` names a thread whose stop may have changed. */
export const STOPS_CHANNEL = "stops";
/** Threads per `stops` RPC call; the frontend batches above this. */
export const STOPS_BATCH = 200;

/** The events that decide whether a thread's latest turn ended with an interruption. */
export const STOP_EVENT_TYPES = ["system/thread/interrupted", "turn/completed"] as const;

/**
 * How many of the newest STOP_EVENT_TYPES rows to read. After an interruption at most one
 * `turn/completed` with status `interrupted` belongs to it (bb writes it before the interruption
 * on a restart and after it on a manual stop); the next row is a normal completion or another
 * interruption. So a handful of rows always reaches the deciding one.
 */
export const STOP_EVENT_LIMIT = 8;

export interface Interruption {
  readonly seq: number;
  /** Epoch ms. */
  readonly at: number;
  readonly reason: string;
  readonly cause: string | null;
}

function field(data: unknown, key: string): unknown {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>)[key] : undefined;
}

/**
 * The newest interruption, unless a turn completed after it (any `turn/completed` whose status is
 * not `interrupted`): the stop that still explains where the thread stands, or null. Rows may come
 * in any order.
 */
export function standingInterruption(rows: readonly EventRow[]): Interruption | null {
  const newestFirst = [...rows].sort((a, b) => b.seq - a.seq);
  for (const row of newestFirst) {
    if (row.type === "turn/completed") {
      if (field(row.data, "status") !== "interrupted") return null;
      continue;
    }
    if (row.type !== "system/thread/interrupted") continue;
    const reason = field(row.data, "reason");
    const cause = field(row.data, "cause");
    return {
      seq: row.seq,
      at: row.createdAt,
      reason: typeof reason === "string" ? reason : "unknown",
      cause: typeof cause === "string" ? cause : null,
    };
  }
  return null;
}

export type StopKind = "stopped" | "daemon-restarted" | "connection-lost" | "host-removed" | "turn-idle" | "unknown";

export function kindOf(interruption: Interruption): StopKind {
  switch (interruption.reason) {
    case "manual-stop":
      return "stopped";
    case RESTART_REASON:
      return interruption.cause === "host-connection-lost" ? "connection-lost" : "daemon-restarted";
    case "host-removed":
      return "host-removed";
    case "provider-turn-idle":
      return "turn-idle";
    default:
      return "unknown";
  }
}

/** Who stopped it, as far as bb's record tells: a person or agent (indistinguishable), or bb. */
export type Actor = "person-or-agent" | "bb";

export const actorOf = (kind: StopKind): Actor => (kind === "stopped" ? "person-or-agent" : "bb");

/** The resume policy's part: only restart interruptions are ever resumed. */
export type ResumeState =
  | { readonly kind: "resumed"; readonly chain: number; readonly max: number; readonly at: number }
  | { readonly kind: "due" }
  | { readonly kind: "held"; readonly why: HeldReason }
  | { readonly kind: "none" };

/** The skips a person may wonder about; the rest mean "not this plugin's business". */
export type HeldReason = Extract<SkipReason, "disabled" | "stale" | "waiting-on-user" | "cap-reached" | "parent-resumes">;

const HELD: readonly SkipReason[] = ["disabled", "stale", "waiting-on-user", "cap-reached", "parent-resumes"];

/**
 * What restart-resume did about this interruption: its record claims it (resumed), the policy
 * would resume it now (due), or the policy holds it back. `decision` is the policy's current
 * answer for the thread, or null when it was not asked.
 */
export function resumeStateOf(
  interruption: Interruption,
  record: ResumeRecord | null,
  decision: Decision | null,
  maxConsecutive: number,
): ResumeState {
  if (interruption.reason !== RESTART_REASON) return { kind: "none" };
  if (record !== null && record.interruptionSeq === interruption.seq) {
    return { kind: "resumed", chain: record.chain, max: maxConsecutive, at: record.resumedAt };
  }
  if (decision === null) return { kind: "none" };
  if (decision.action === "resume") return { kind: "due" };
  return HELD.includes(decision.reason) ? { kind: "held", why: decision.reason as HeldReason } : { kind: "none" };
}

/** One thread's standing stop, as the server sends it to the frontend (plain JSON). */
export interface StopView {
  readonly threadId: string;
  readonly interruption: Interruption;
  readonly kind: StopKind;
  readonly actor: Actor;
  readonly resume: ResumeState;
}

export function stopView(
  threadId: string,
  interruption: Interruption,
  resume: ResumeState,
): StopView {
  const kind = kindOf(interruption);
  return { threadId, interruption, kind, actor: actorOf(kind), resume };
}

export type Tone = "default" | "error" | "running" | "success";

/** What the frontend draws: a short badge, a one-line accessible label, and tooltip lines. */
export interface Presentation {
  readonly short: string;
  readonly label: string;
  readonly details: readonly string[];
  /** A bb icon name (BbIconName). */
  readonly icon: string;
  readonly tone: Tone;
}

const KIND_SHORT: Record<StopKind, string> = {
  stopped: "Stopped",
  "daemon-restarted": "Daemon restart",
  "connection-lost": "Connection lost",
  "host-removed": "Host removed",
  "turn-idle": "Turn idle",
  unknown: "Interrupted",
};

const KIND_ICON: Record<StopKind, string> = {
  stopped: "Square",
  "daemon-restarted": "RotateCcw",
  "connection-lost": "CloudOff",
  "host-removed": "Delete",
  "turn-idle": "Pause",
  unknown: "AlertCircle",
};

const KIND_BY: Record<StopKind, string> = {
  stopped: "you or an agent (bb does not record which)",
  "daemon-restarted": "bb: the host daemon restarted",
  "connection-lost": "bb: the host's connection was lost and its daemon came back without the turn",
  "host-removed": "bb: the thread's machine was removed",
  "turn-idle": "bb: the provider's turn went idle",
  unknown: "bb",
};

const HELD_TEXT: Record<HeldReason, string> = {
  disabled: "off (restart-resume is disabled)",
  stale: "not resumed: too old",
  "waiting-on-user": "not resumed: it was waiting on your answer",
  "cap-reached": "not resumed: too many resumes in a row",
  "parent-resumes": "not resumed: its parent is resumed and re-drives it",
};

const HELD_SHORT: Record<HeldReason, string> = {
  disabled: "not resumed",
  stale: "not resumed",
  "waiting-on-user": "waiting on you",
  "cap-reached": "cap reached",
  "parent-resumes": "parent resumes",
};

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const BUSY = new Set(["starting", "active", "stopping"]);

/** How to show a stop. `threadStatus` is bb's thread status now ("unknown" when not known). */
export function present(view: StopView, threadStatus: string, now: number): Presentation {
  const { interruption, kind, resume } = view;
  const base = KIND_SHORT[kind];
  let suffix = "";
  let resumeLine: string | null = null;
  let tone: Tone = kind === "stopped" || kind === "turn-idle" ? "default" : "error";
  let icon = KIND_ICON[kind];
  switch (resume.kind) {
    case "resumed":
      suffix = ` → resumed ${resume.chain}/${resume.max}`;
      resumeLine = `Auto-resume: resumed ${resume.chain} of ${resume.max}, ${ago(resume.at, now)}`;
      tone = BUSY.has(threadStatus) ? "running" : "default";
      icon = "ArrowReloadHorizontal";
      break;
    case "due":
      suffix = " → resuming";
      resumeLine = "Auto-resume: about to resume";
      tone = "running";
      icon = "ArrowReloadHorizontal";
      break;
    case "held":
      suffix = ` → ${HELD_SHORT[resume.why]}`;
      resumeLine = `Auto-resume: ${HELD_TEXT[resume.why]}`;
      break;
    case "none":
      if (interruption.reason === RESTART_REASON) resumeLine = "Auto-resume: not resumed";
      break;
  }
  const short = `${base}${suffix}`;
  const reason = interruption.cause === null ? interruption.reason : `${interruption.reason} (${interruption.cause})`;
  const details = [
    `${short}`,
    `Reason: ${reason}`,
    `By: ${KIND_BY[kind]}`,
    `When: ${ago(interruption.at, now)}`,
    ...(resumeLine === null ? [] : [resumeLine]),
    "Clears when a later turn completes.",
  ];
  return { short, label: `Last turn interrupted: ${short}`, details, icon, tone };
}

/** A sidebar row status, the shape bb's `experimental_setThreadRowStatus` takes. */
export interface RowStatus {
  readonly icon: string;
  readonly label: string;
  readonly tone: Tone;
}

export function rowStatusOf(presentation: Presentation): RowStatus {
  return { icon: presentation.icon, label: presentation.label, tone: presentation.tone };
}

const sameRow = (a: RowStatus, b: RowStatus): boolean => a.icon === b.icon && a.label === b.label && a.tone === b.tone;

/**
 * The setter calls that take the sidebar from `applied` to `desired`: set what is new or changed,
 * clear (null) what is no longer desired. Leaves `applied` untouched.
 */
export function rowStatusChanges(
  applied: ReadonlyMap<string, RowStatus>,
  desired: ReadonlyMap<string, RowStatus>,
): [string, RowStatus | null][] {
  const changes: [string, RowStatus | null][] = [];
  for (const [threadId, row] of desired) {
    const before = applied.get(threadId);
    if (before === undefined || !sameRow(before, row)) changes.push([threadId, row]);
  }
  for (const threadId of applied.keys()) if (!desired.has(threadId)) changes.push([threadId, null]);
  return changes;
}

/** Split ids into batches of at most `size`. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
