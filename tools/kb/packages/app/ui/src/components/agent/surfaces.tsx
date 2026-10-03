import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUpIcon,
  ChatCircleDotsIcon,
  CircleNotchIcon,
  PlusIcon,
  StopIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { IconButton } from "@/sdk";
import { decideCall, restartChat, sendToAgent, stopAgent, useChat } from "@/components/agent/chat";
import { Entry } from "@/components/agent/entries";

/** How tall the composer grows before it scrolls, in px. */
const COMPOSER_MAX_PX = 160;

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <ChatCircleDotsIcon size={24} className="text-foreground/20" />
      <p className="text-note text-foreground/55">Ask about what is on your screen.</p>
      <p className="text-meta text-foreground/35">
        The agent sees the open view, the focus and the selection, and works through kb’s own
        actions. A change that needs your approval waits for it here.
      </p>
    </div>
  );
}

function fit(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  area.style.height = `${Math.min(area.scrollHeight, COMPOSER_MAX_PX)}px`;
}

function Composer() {
  const running = useChat((s) => s.transcript.running);
  const offline = useChat((s) => s.unreachable !== null);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !running && !offline && text.trim() !== "";

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!canSend) return;
    sendToAgent(text.trim());
    setText("");
    if (ref.current !== null) {
      ref.current.value = "";
      fit(ref.current);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  return (
    <form className="shrink-0 border-t border-foreground/[0.06] p-3" onSubmit={submit}>
      <div className="flex items-end gap-1.5 rounded-lg border border-foreground/10 bg-background py-1.5 pl-3 pr-1.5 transition-colors focus-within:border-foreground/25">
        <textarea
          ref={ref}
          rows={1}
          autoFocus
          aria-label="Message the agent"
          placeholder="Ask the agent…"
          className="min-h-6 flex-1 resize-none bg-transparent py-0.5 text-ui text-foreground outline-none placeholder:text-foreground/30"
          onInput={(e) => {
            setText(e.currentTarget.value);
            fit(e.currentTarget);
          }}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <IconButton label="Stop the agent" icon={StopIcon} size="md" onClick={stopAgent} />
        ) : (
          <button
            type="submit"
            aria-label="Send"
            title="Send"
            disabled={!canSend}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity duration-100 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:bg-foreground/10 disabled:text-foreground/30"
          >
            <ArrowUpIcon size={13} weight="bold" aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-caption text-foreground/30">
        Enter sends, Shift+Enter starts a new line. Your screen goes with each message.
      </p>
    </form>
  );
}

function Conversation() {
  const transcript = useChat((s) => s.transcript);
  const scroller = useRef<HTMLDivElement>(null);
  const last = transcript.entries.at(-1);
  // Working: a turn runs, nothing of the agent's is streaming yet, and no
  // call is waiting for the person (its card says so itself).
  const waiting = last?.kind === "tool" && last.state === "awaiting";
  const working = transcript.running && last?.kind !== "agent" && !waiting;

  // Follow the reply as it streams, unless the person has scrolled up to read.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (nearBottom || last?.kind === "user") box.scrollTop = box.scrollHeight;
  }, [last]);

  if (transcript.entries.length === 0) return <EmptyState />;
  return (
    <div
      ref={scroller}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      role="log"
      aria-live="polite"
      aria-label="Conversation with the agent"
    >
      {transcript.entries.map((entry) => (
        <Entry key={entry.id} entry={entry} decide={decideCall} />
      ))}
      {working ? (
        <p className="flex items-center gap-1.5 text-label text-foreground/35">
          <CircleNotchIcon size={12} className="motion-safe:animate-spin" aria-hidden />
          Working…
        </p>
      ) : null}
    </div>
  );
}

function Unreachable() {
  const unreachable = useChat((s) => s.unreachable);
  if (unreachable === null) return null;
  return (
    <p className="mx-3 flex items-start gap-1.5 rounded-md bg-foreground/[0.04] px-2.5 py-1.5 text-label text-foreground/60">
      <WarningIcon size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden />
      {unreachable}
    </p>
  );
}

/** The agent's dock: its header, the conversation and the composer. */
export function AgentDock({ onClose }: { readonly onClose: () => void }) {
  const running = useChat((s) => s.transcript.running);
  const empty = useChat((s) => s.transcript.entries.length === 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-foreground/[0.06] pl-4 pr-2">
        <h2 className="text-ui font-medium text-foreground/60">Agent</h2>
        {running ? <span className="text-label text-foreground/35">working</span> : null}
        <span className="flex-1" />
        <IconButton
          label="New conversation"
          icon={PlusIcon}
          size="md"
          disabled={empty}
          className="disabled:pointer-events-none disabled:opacity-40"
          onClick={restartChat}
        />
        <IconButton label="Close the agent" icon={XIcon} size="md" onClick={onClose} />
      </header>
      <Conversation />
      <Unreachable />
      <Composer />
    </div>
  );
}
