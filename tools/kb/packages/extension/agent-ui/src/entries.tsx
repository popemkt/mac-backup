import { useState, type ReactNode } from "react";
import {
  CaretRightIcon,
  CheckIcon,
  CircleNotchIcon,
  HandPalmIcon,
  MinusCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { ToolEntry, TranscriptEntry } from "@kb/agent";
import { cn, MdView, useFollow, useRefInk } from "@kb/ui-sdk";

/** A value as the cards show it: JSON, two-space indented. */
function shown(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

/** Text the person or the agent wrote: inline markdown, `[[id|label]]` refs followable. */
function Prose({ text, className }: { text: string; className?: string }) {
  const follow = useFollow();
  const ink = useRefInk();
  return <MdView text={text} onFollow={follow} ink={ink} className={cn("text-ui", className)} />;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption uppercase tracking-wide text-foreground/35">{label}</span>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-caption text-foreground/60">
        {children}
      </pre>
    </div>
  );
}

function StatusGlyph({ entry }: { entry: ToolEntry }) {
  if (entry.state === "running" || entry.state === "deciding") {
    return (
      <CircleNotchIcon
        size={13}
        className="shrink-0 text-foreground/40 motion-safe:animate-spin"
        aria-label="Running"
      />
    );
  }
  if (entry.state === "stopped") {
    return (
      <MinusCircleIcon size={13} className="shrink-0 text-foreground/30" aria-label="Stopped" />
    );
  }
  if (entry.state === "awaiting") {
    return (
      <HandPalmIcon size={13} className="shrink-0 text-primary" aria-label="Waiting for you" />
    );
  }
  return entry.receipt?.status === "succeeded" ? (
    <CheckIcon size={13} weight="bold" className="shrink-0 text-success" aria-label="Done" />
  ) : (
    <WarningCircleIcon size={13} className="shrink-0 text-destructive" aria-label="Failed" />
  );
}

/** What the person chose, and what came of it, on a call that needed them. */
function decisionNote(entry: ToolEntry): string | null {
  if (entry.decision === null) return null;
  if (entry.decision === "declined") return "You declined this.";
  return entry.state === "deciding" ? "Approved, running…" : "You approved this.";
}

/** One tool call: a line that opens onto its input and its receipt. */
function ToolCard({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  // A decline is refused by the invoke core; the note says so in the person's words.
  const failure =
    entry.receipt?.status === "failed" && entry.decision !== "declined" ? entry.receipt : null;
  const note = decisionNote(entry);
  return (
    <div className="rounded-md border border-foreground/[0.08] bg-foreground/[0.02]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <StatusGlyph entry={entry} />
        <span className="min-w-0 truncate text-meta font-medium text-foreground/75">
          {entry.title}
        </span>
        <code className="min-w-0 truncate font-mono text-caption text-foreground/35">
          {entry.action}
        </code>
        <span className="flex-1" />
        <CaretRightIcon
          size={11}
          weight="bold"
          className={cn("shrink-0 text-foreground/30 transition-transform", open && "rotate-90")}
        />
      </button>
      {failure === null && note === null ? null : (
        <p className="px-2.5 pb-1.5 text-label text-foreground/50">
          {note === null ? null : <span>{note} </span>}
          {failure === null ? null : <span>{failure.message}</span>}
        </p>
      )}
      {open ? (
        <div className="flex flex-col gap-2 border-t border-foreground/[0.06] px-2.5 py-2">
          <Field label="Input">{shown(entry.input)}</Field>
          {entry.receipt === null ? null : (
            <Field label={entry.receipt.status === "succeeded" ? "Output" : entry.receipt.code}>
              {shown(entry.receipt.status === "succeeded" ? entry.receipt.output : entry.receipt)}
            </Field>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A call that waits for the person: what it is, and the two answers. */
function ApprovalCard({
  entry,
  decide,
}: {
  entry: ToolEntry;
  decide: (call: string, approved: boolean) => void;
}) {
  return (
    <div
      className="rounded-md border border-primary/30 bg-primary/[0.05] px-3 py-2.5"
      role="group"
      aria-label={`Approve ${entry.title}?`}
    >
      <div className="flex items-center gap-2">
        <HandPalmIcon size={14} className="shrink-0 text-primary" />
        <span className="text-meta font-medium text-foreground/85">Approve {entry.title}?</span>
      </div>
      <p className="mt-1 text-label text-foreground/50">
        The agent wants to run <code className="font-mono">{entry.action}</code>, which needs your
        approval.
      </p>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-foreground/[0.04] px-2 py-1.5 font-mono text-caption text-foreground/65">
        {shown(entry.input)}
      </pre>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1 text-meta font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/60"
          onClick={() => decide(entry.id, true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-1 text-meta text-foreground/60 outline-none hover:bg-foreground/5 hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-primary/60"
          onClick={() => decide(entry.id, false)}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

/** One entry of the transcript, as the dock draws it. */
export function Entry({
  entry,
  decide,
}: {
  entry: TranscriptEntry;
  decide: (call: string, approved: boolean) => void;
}) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="ml-8 self-end rounded-lg bg-foreground/[0.05] px-3 py-1.5">
          <Prose text={entry.text} className="text-foreground/85" />
        </div>
      );
    case "agent":
      return <Prose text={entry.text} className="text-foreground/85" />;
    case "tool":
      return entry.state === "awaiting" ? (
        <ApprovalCard entry={entry} decide={decide} />
      ) : (
        <ToolCard entry={entry} />
      );
    case "notice":
      return (
        <p
          className={cn(
            "flex items-center gap-1.5 text-label",
            entry.tone === "error" ? "text-foreground/60" : "text-foreground/35",
          )}
        >
          {entry.tone === "error" ? (
            <WarningCircleIcon size={12} className="shrink-0 text-destructive" />
          ) : null}
          {entry.text}
        </p>
      );
    default: {
      const unhandled: never = entry;
      return unhandled;
    }
  }
}
