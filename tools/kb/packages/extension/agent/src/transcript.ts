import type { ActionReceipt } from "@kb/contracts";
import type { AgentEvent } from "./protocol.ts";

/**
 * A conversation as the sidebar shows it, built from what the person sent
 * and what the bridge said. It is a pure reduction over the channel's
 * events, so the sidebar draws it and tests read it without a page. It
 * lives in the sidebar's memory only, like the conversation itself.
 */

/**
 * Where a tool call stands: running on the server, waiting for the person,
 * being made by the person's tab after they chose, answered, or left behind
 * by a turn that ended first.
 */
export type ToolState = "running" | "awaiting" | "deciding" | "done" | "stopped";

export interface ToolEntry {
  readonly kind: "tool";
  /** The bridge's call id. */
  readonly id: string;
  readonly action: string;
  readonly title: string;
  readonly input: unknown;
  readonly approval: boolean;
  readonly state: ToolState;
  readonly receipt: ActionReceipt | null;
  /** What the person chose, for a call that needed them. */
  readonly decision: "approved" | "declined" | null;
}

export type TranscriptEntry =
  | { readonly kind: "user"; readonly id: string; readonly text: string }
  | { readonly kind: "agent"; readonly id: string; readonly text: string }
  | ToolEntry
  | {
      readonly kind: "notice";
      readonly id: string;
      readonly tone: "quiet" | "error";
      readonly text: string;
    };

export interface Transcript {
  readonly conversation: string;
  readonly entries: readonly TranscriptEntry[];
  /** A turn is running: the person can stop it, not send another. */
  readonly running: boolean;
}

export function newTranscript(conversation: string): Transcript {
  return { conversation, entries: [], running: false };
}

function entryId(transcript: Transcript): string {
  return `${transcript.conversation}:${transcript.entries.length}`;
}

function notice(transcript: Transcript, tone: "quiet" | "error", text: string): Transcript {
  return {
    ...transcript,
    entries: [...transcript.entries, { kind: "notice", id: entryId(transcript), tone, text }],
  };
}

function mapTool(
  transcript: Transcript,
  call: string,
  change: (entry: ToolEntry) => ToolEntry,
): Transcript {
  return {
    ...transcript,
    entries: transcript.entries.map((entry) =>
      entry.kind === "tool" && entry.id === call ? change(entry) : entry,
    ),
  };
}

/** The person sent `text`: it shows at once, and a turn is running. */
export function withSent(transcript: Transcript, text: string): Transcript {
  return {
    ...transcript,
    running: true,
    entries: [...transcript.entries, { kind: "user", id: entryId(transcript), text }],
  };
}

/** The person chose for the call `call`; their tab is making it now. */
export function withDecision(
  transcript: Transcript,
  call: string,
  decision: "approved" | "declined",
): Transcript {
  return mapTool(transcript, call, (entry) => ({ ...entry, state: "deciding", decision }));
}

/** The socket closed: the bridge forgot the conversation, and a running turn with it. */
export function withDisconnect(transcript: Transcript): Transcript {
  if (!transcript.running) return transcript;
  return notice(
    { ...stopTools(transcript), running: false },
    "error",
    "The connection to kb dropped, so the agent stopped and forgot this conversation.",
  );
}

function stopTools(transcript: Transcript): Transcript {
  return {
    ...transcript,
    entries: transcript.entries.map((entry) =>
      entry.kind === "tool" && entry.state !== "done" ? { ...entry, state: "stopped" } : entry,
    ),
  };
}

/** What `event` changes; an event of another conversation changes nothing. */
export function withEvent(transcript: Transcript, event: AgentEvent): Transcript {
  if (event.conversation !== undefined && event.conversation !== transcript.conversation) {
    return transcript;
  }
  switch (event.type) {
    case "text": {
      const last = transcript.entries.at(-1);
      if (last?.kind === "agent") {
        return {
          ...transcript,
          entries: [...transcript.entries.slice(0, -1), { ...last, text: last.text + event.delta }],
        };
      }
      const entry: TranscriptEntry = { kind: "agent", id: entryId(transcript), text: event.delta };
      return { ...transcript, entries: [...transcript.entries, entry] };
    }
    case "tool-call": {
      const entry: ToolEntry = {
        kind: "tool",
        id: event.call,
        action: event.action,
        title: event.title,
        input: event.input,
        approval: event.approval,
        state: event.approval ? "awaiting" : "running",
        receipt: null,
        decision: null,
      };
      return { ...transcript, entries: [...transcript.entries, entry] };
    }
    case "tool-result":
      return mapTool(transcript, event.call, (entry) => ({
        ...entry,
        state: "done",
        receipt: event.receipt,
      }));
    case "turn-end": {
      const ended = { ...stopTools(transcript), running: false };
      if (event.outcome === "cancelled") return notice(ended, "quiet", "Stopped.");
      if (event.outcome === "failed") {
        return notice(ended, "error", event.message ?? "The agent failed.");
      }
      return ended;
    }
    case "refused":
      return notice({ ...transcript, running: false }, "error", event.reason);
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
