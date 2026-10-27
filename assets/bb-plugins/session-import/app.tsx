// bb-plugin-session-import — the frontend. One picker, reachable from the New thread screen's right panel and from
// its own page in the navigation; and an "Original session" tab beside an imported thread. Rules live in core/ and
// server.ts; this file only draws them.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  Markdown,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
  type PluginNewThreadPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { ListedSession, Machine, rpcContract, ThreadRecord } from "./server.ts";
import type { Plan, ToolCall, Transcript } from "./core/transcript.ts";
import type { Target } from "./core/mapping.ts";

const PAGE = "import";
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const n = (x: number) => x.toLocaleString("en-US");
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    load()
      .then(
        v => live && (setValue(v), setError(null)),
        e => live && setError(message(e)),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { value, error, loading, reload: () => setTick(t => t + 1) };
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;
const ErrorLine = ({ text }: { text: string | null }) => (text === null ? null : <p className="text-xs text-destructive">{text}</p>);

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ the picker

function Picker() {
  const rpc = useRpc<typeof rpcContract>();
  const machines = useAsync(() => rpc.call("machines", {}), [rpc]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list: Machine[] = machines.value?.machines ?? [];
  const machine = hostId ?? list.find(m => m.isServer)?.id ?? list[0]?.id ?? null;
  const sessions = useAsync(
    () => (machine === null ? Promise.resolve(null) : rpc.call("sessions", { hostId: machine, sinceDays: all ? 0 : 30 })),
    [rpc, machine, all],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = sessions.value?.sessions ?? [];
    return q.length === 0 ? rows : rows.filter(s => [s.title, s.firstPrompt, s.cwd, s.sessionId].some(v => v?.toLowerCase().includes(q)));
  }, [sessions.value, query]);

  if (selected !== null && machine !== null) {
    const session = sessions.value?.sessions.find(s => s.sessionId === selected) ?? null;
    return <Preview rpc={rpc} hostId={machine} machines={list} sessionId={selected} session={session} onBack={() => setSelected(null)} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 text-sm">
      <div>
        <h2 className="text-base font-medium">Import a Claude Code session</h2>
        <Muted>
          Continue a session that ran outside bb. The new thread starts on that machine, in the session's directory, with
          its cleaned transcript. The session itself is never changed.
        </Muted>
      </div>
      <ErrorLine text={machines.error} />
      <div className="flex flex-wrap gap-1.5">
        {list.map(m => (
          <Chip key={m.id} active={m.id === machine} onClick={() => (setHostId(m.id), setSelected(null))}>
            {m.name}
            {m.connected ? "" : " (offline)"}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by title, prompt or directory"
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground"
        />
        <Chip active={!all} onClick={() => setAll(false)}>
          30 days
        </Chip>
        <Chip active={all} onClick={() => setAll(true)}>
          All
        </Chip>
      </div>
      <ErrorLine text={sessions.error} />
      {sessions.loading && sessions.value === null ? <Muted>Reading sessions…</Muted> : null}
      {sessions.value !== null ? (
        <Muted>
          {shown.length} of {sessions.value.total} sessions{all ? "" : " from the last 30 days"}
        </Muted>
      ) : null}
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {shown.map(s => (
          <SessionRow key={s.sessionId} s={s} onPick={() => setSelected(s.sessionId)} />
        ))}
      </ul>
    </div>
  );
}

function SessionRow({ s, onPick }: { s: ListedSession; onPick: () => void }) {
  const last = s.imports.at(-1);
  return (
    <li>
      <button type="button" onClick={onPick} className="flex w-full flex-col gap-0.5 px-1 py-2 text-left hover:bg-muted/50">
        <span className="truncate font-medium">{s.title ?? s.firstPrompt ?? s.sessionId}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{s.cwd ?? "unknown directory"}</span>
        <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{ago(s.lastModified)}</span>
          {s.gitBranch === null ? null : <span>{s.gitBranch}</span>}
          <span>{mb(s.fileSize)}</span>
          {s.ownedByThreadId !== null ? <span className="text-amber-600">a bb thread</span> : null}
          {last !== undefined ? <span className="text-sky-600">imported{s.lastModified > last.importedAt ? ", changed since" : ""}</span> : null}
        </span>
      </button>
    </li>
  );
}

function Preview(props: { rpc: Rpc; hostId: string; machines: Machine[]; sessionId: string; session: ListedSession | null; onBack: () => void }) {
  const { rpc, hostId, machines, sessionId, session } = props;
  const nav = useBbNavigate();
  const [targetHostId, setTargetHostId] = useState<string>(hostId);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [first, setFirst] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useAsync(
    () => rpc.call("preview", { hostId, sessionId, targetHostId, ...(projectId === undefined ? {} : { projectId }) }),
    [rpc, hostId, sessionId, targetHostId, projectId],
  );
  const p = preview.value;
  const run = () => {
    setImporting(true);
    setError(null);
    rpc
      .call("importSession", { hostId, sessionId, targetHostId, ...(projectId === undefined ? {} : { projectId }), ...(first.trim().length > 0 ? { firstMessage: first } : {}) })
      .then(r => nav.toThread(r.threadId), e => setError(message(e)))
      .finally(() => setImporting(false));
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-sm">
      <button type="button" onClick={props.onBack} className="self-start text-xs text-muted-foreground hover:text-foreground">
        ← All sessions
      </button>
      {session?.ownedByThreadId != null ? (
        <p className="rounded border border-amber-500/40 p-2 text-xs">
          A bb thread already runs this session.{" "}
          <button type="button" className="underline" onClick={() => nav.toThread(session.ownedByThreadId!)}>
            Open it
          </button>{" "}
          instead, or import a copy anyway.
        </p>
      ) : null}
      <ErrorLine text={preview.error} />
      {p === null ? (
        <Muted>{preview.loading ? "Reading the session…" : ""}</Muted>
      ) : (
        <>
          <Markdown content={p.header} />
          <PlanLine plan={p.plan} />
          <details className="text-xs" open>
            <summary className="cursor-pointer text-muted-foreground">Where the session stood (goes first, never cut)</summary>
            <div className="mt-2">
              <Markdown content={p.brief.replace(/^## Where the session stood\n\n/, "")} />
            </div>
          </details>
          {p.imports.length > 0 ? (
            <p className="text-xs">
              Imported before:{" "}
              {p.imports.map(i => (
                <button key={i.threadId} type="button" className="mr-2 underline" onClick={() => nav.toThread(i.threadId)}>
                  {new Date(i.importedAt).toLocaleString()}
                </button>
              ))}
            </p>
          ) : null}
          <TargetForm target={p.target} machines={machines} projects={p.projects} targetHostId={targetHostId} setTargetHostId={setTargetHostId} setProjectId={setProjectId} />
          {p.target.notes.map(note => (
            <Muted key={note}>{note}</Muted>
          ))}
          <ErrorLine text={p.environmentError} />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">First message (optional; without one, the agent summarises where the session stood)</span>
            <textarea
              value={first}
              onChange={e => setFirst(e.target.value)}
              rows={3}
              className="rounded border border-border bg-transparent p-2 text-sm outline-none focus:border-foreground"
            />
          </label>
          <ErrorLine text={error} />
          <button
            type="button"
            disabled={importing || p.environmentError !== null}
            onClick={run}
            className="self-start rounded bg-foreground px-3 py-1.5 text-background disabled:opacity-50"
          >
            {importing ? "Starting…" : "Import as a new thread"}
          </button>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">How the session opens and ends</summary>
            <div className="mt-2 flex flex-col gap-2">
              <Markdown content={p.opening} />
              {p.ending.length > 0 ? (
                <>
                  <Muted>…</Muted>
                  <Markdown content={p.ending} />
                </>
              ) : null}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function PlanLine({ plan }: { plan: Plan }) {
  const cut = plan.omitted > 0 || plan.condensed > 0;
  return (
    <p className="text-xs">
      Hands over <b>{n(plan.tokens)}</b> tokens{cut ? ` of ${n(plan.fullTokens)}` : ""}: {plan.full} turns in full
      {plan.condensed > 0 ? `, ${plan.condensed} without tool lines` : ""}
      {plan.omitted > 0 ? `, ${plan.omitted} left out` : ""}. Tool output stays out; the whole transcript goes along as a file.
    </p>
  );
}

function TargetForm(props: {
  target: Target;
  machines: Machine[];
  projects: { id: string; name: string }[];
  targetHostId: string;
  setTargetHostId: (id: string) => void;
  setProjectId: (id: string | undefined) => void;
}) {
  const { target } = props;
  const select = "rounded border border-border bg-transparent px-1.5 py-1 text-sm";
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
      <span className="text-muted-foreground">Project</span>
      <select className={select} value={target.projectId ?? ""} onChange={e => props.setProjectId(e.target.value === "" ? undefined : e.target.value)}>
        {target.projectId === null ? <option value="">Choose a project</option> : null}
        {props.projects.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">Machine</span>
      <select className={select} value={props.targetHostId} onChange={e => props.setTargetHostId(e.target.value)}>
        {props.machines.map(m => (
          <option key={m.id} value={m.id} disabled={!m.connected}>
            {m.name}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">Directory</span>
      <span className="truncate font-mono">{target.path ?? "the project's own source on that machine"}</span>
    </div>
  );
}

// ------------------------------------------------------------------ the original session, beside the thread

function ToolRow({ call, threadId }: { call: ToolCall; threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [out, setOut] = useState<{ text: string | null; totalChars: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <details
      className="text-xs"
      onToggle={e => {
        if ((e.currentTarget as HTMLDetailsElement).open && out === null && call.id.length > 0) {
          rpc.call("toolOutput", { threadId, toolUseId: call.id }).then(setOut, err => setError(message(err)));
        }
      }}
    >
      <summary className="cursor-pointer truncate font-mono text-muted-foreground">
        {call.name}
        {call.summary.length > 0 ? `: ${call.summary}` : ""}
        {call.failed ? ` (failed${call.error === undefined ? "" : `: ${call.error}`})` : ""}
        {call.outputChars > 0 ? ` · ${n(call.outputChars)} chars` : ""}
      </summary>
      <ErrorLine text={error} />
      {out !== null ? <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2">{out.text ?? "(not in the session file)"}</pre> : null}
    </details>
  );
}

function SyncBar({ threadId, turns, onDone }: { threadId: string; turns: number; onDone: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="flex-1">
          The session went on: {turns} new turn{turns === 1 ? "" : "s"} since this thread took it.
        </span>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-foreground px-2 py-1 text-background disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            setError(null);
            rpc
              .call("sync", { threadId })
              .then(onDone, e => setError(message(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Sending…" : "Send them to this thread"}
        </button>
      </div>
      <ErrorLine text={error} />
    </div>
  );
}

function OriginalSession({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const o = useAsync(() => rpc.call("original", { threadId }), [rpc, threadId]);
  const record: ThreadRecord | null = o.value?.record ?? null;
  const t: Transcript | null = o.value?.transcript ?? null;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ErrorLine text={o.error} />
      {o.value?.reason != null ? <Muted>{o.value.reason}</Muted> : null}
      {record !== null ? (
        <Muted>
          Imported {new Date(record.importedAt).toLocaleString()} from {record.machine}
          {record.cwd === null ? "" : `, ${record.cwd}`}. The thread was handed {n(record.plan.tokens)} tokens
          {record.plan.omitted > 0 ? `, ${record.plan.omitted} older turns left out` : ""}. Full transcript: {record.transcriptPath}
        </Muted>
      ) : null}
      {o.value?.newTurns != null && o.value.newTurns > 0 ? <SyncBar threadId={threadId} turns={o.value.newTurns} onDone={o.reload} /> : null}
      {o.loading && t === null ? <Muted>Reading the session on its machine…</Muted> : null}
      {t?.turns.map(turn =>
        turn.kind === "compaction" ? (
          <details key={turn.uuid} className="rounded border border-dashed border-border p-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Compacted by Claude Code{turn.preTokens === null ? "" : ` at ${n(turn.preTokens)} tokens`}</summary>
            {turn.summary === null ? null : <Markdown content={turn.summary} />}
          </details>
        ) : (
          <section key={turn.uuid} className="flex flex-col gap-1.5">
            {turn.user !== null ? (
              <div className="rounded bg-muted/60 p-2">
                <Markdown content={turn.user.text + (turn.user.images > 0 ? `\n\n[${turn.user.images} image(s)]` : "")} />
              </div>
            ) : null}
            {turn.blocks.map((b, i) =>
              b.kind === "text" ? (
                <Markdown key={i} content={b.text} />
              ) : b.kind === "notice" ? (
                <Muted key={i}>Notification: {b.text}</Muted>
              ) : (
                <ToolRow key={i} call={b.call} threadId={threadId} />
              ),
            )}
          </section>
        ),
      )}
    </div>
  );
}

// ------------------------------------------------------------------ registration

function ImportPage(_: PluginNavPanelProps) {
  return (
    <div className="mx-auto h-full w-full max-w-3xl">
      <Picker />
    </div>
  );
}

function ImportPanel(_: PluginNewThreadPanelProps) {
  return <Picker />;
}

export default definePluginApp(app => {
  app.slots.navPanel({ id: PAGE, title: "Import sessions", icon: "ArchiveRestore", path: PAGE, component: ImportPage });
  app.slots.experimental_newThreadPanelAction({ id: "import", title: "Import Claude Code session", icon: "ArchiveRestore", layout: "flush", component: ImportPanel });
  app.slots.threadPanelAction({
    id: "original",
    title: "Original session",
    icon: "Clock",
    layout: "padded",
    component: OriginalSession,
    run: ({ openPanel }) => {
      openPanel({ title: "Original session" });
    },
  });
});
