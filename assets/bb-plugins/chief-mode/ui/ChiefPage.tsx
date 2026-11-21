// The Chief page: the hierarchy as a tree of real threads. Every row opens the ordinary thread
// (bb's own view, so every other plugin's UI is there too); nothing here replaces the thread list.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { Member, ProjectNode, TaskNode } from "../core/tree.ts";
import type { RosterView, rpcContract } from "../server.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const CHANGED_CHANNEL = "chief-mode:changed";
/** Tasks emits no events: task status on the page is re-read on this interval. */
const POLL_MS = 15_000;

export function useRoster() {
  const rpc = useRpc<typeof rpcContract>();
  const [roster, setRoster] = useState<RosterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("roster", { projectId: null }).then(
      (next) => {
        setRoster(next);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
    const timer = setInterval(refetch, POLL_MS);
    return () => clearInterval(timer);
  }, [refetch]);
  useRealtime(CHANGED_CHANNEL, refetch);
  return { rpc, roster, error, setError, refetch };
}

const WORKING = new Set(["active", "starting", "pending", "stopping"]);

function StatusDot({ member }: { member: Member }) {
  const tone =
    member.pending > 0 ? "bg-amber-500" : member.status === "error" ? "bg-destructive" : WORKING.has(member.status) ? "bg-primary animate-pulse" : "bg-muted-foreground/50";
  const label = member.pending > 0 ? "waiting on you" : member.status;
  return <span role="img" aria-label={label} title={label} className={cn("inline-block size-2 shrink-0 rounded-full", tone)} />;
}

function MemberRow({ member, label, depth }: { member: Member; label: string; depth: number }) {
  const navigate = useBbNavigate();
  return (
    <li>
      <button
        type="button"
        onClick={(event) => navigate.toThread(member.threadId, { split: event.metaKey || event.ctrlKey })}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover"
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        data-thread-id={member.threadId}
      >
        <StatusDot member={member} />
        <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate">{member.title}</span>
        {member.pending > 0 ? <span className="shrink-0 rounded bg-amber-500/15 px-1.5 text-xs text-amber-600">needs you</span> : null}
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{member.status}</span>
      </button>
    </li>
  );
}

function TaskRows({ task }: { task: TaskNode }) {
  return (
    <>
      <li className="flex items-center gap-2 px-2 py-1 text-sm" style={{ paddingLeft: "3rem" }}>
        <Icon name="CircleCheck" className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs">{task.key}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{task.title}</span>
        {task.status === null ? null : <span className="shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">{task.status.replace("_", " ")}</span>}
      </li>
      {task.architects.map((architect) => (
        <MemberRow key={architect.threadId} member={architect} label="Architect" depth={3} />
      ))}
    </>
  );
}

function ProjectRows({ project }: { project: ProjectNode }) {
  return (
    <>
      <li className="flex items-center gap-2 px-2 pb-1 pt-3 text-sm font-medium" style={{ paddingLeft: "1.75rem" }}>
        <Icon name="Folder" className="size-4 text-muted-foreground" />
        <span className="truncate">{project.name}</span>
      </li>
      {project.chiefs.length === 0 ? (
        <li className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: "3rem" }}>
          No project chief (the coordinator can stand one up with cm_project_chief)
        </li>
      ) : (
        project.chiefs.map((chief) => <MemberRow key={chief.threadId} member={chief} label="Chief" depth={2} />)
      )}
      {project.tasks.map((task) => (
        <TaskRows key={task.key} task={task} />
      ))}
    </>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

type RosterApi = Pick<ReturnType<typeof useRoster>, "rpc" | "refetch">;

function CoordinatorComposer({ api: { rpc, refetch }, coordinatorId, onError }: { api: RosterApi; coordinatorId: string | null; onError: (message: string) => void }) {
  const navigate = useBbNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (coordinatorId === null) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
        <span className="flex-1 text-muted-foreground">No coordinator yet. Create one, or adopt an existing thread below.</span>
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { threadId } = await rpc.call("createCoordinator", { projectId: null, title: null });
              refetch();
              navigate.toThread(threadId);
            })
          }
        >
          <Icon name="Plus" className="size-4" />
          Create coordinator
        </Button>
      </div>
    );
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = text.trim();
    if (next === "" || busy) return;
    void run(async () => {
      const result = await rpc.call("messageCoordinator", { text: next });
      setText("");
      setSent(result.delivery === "queued" ? "Queued for the coordinator (it is busy)." : "Sent to the coordinator.");
    });
  };
  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
        }}
        rows={3}
        placeholder="Tell the coordinator what you want done…"
        aria-label="Message the coordinator"
        className="w-full resize-y bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 text-xs text-muted-foreground">{sent ?? "⌘/Ctrl+Enter to send. Replies land in the coordinator thread."}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate.toThread(coordinatorId)}>
          Open thread
        </Button>
        <Button type="submit" size="sm" disabled={busy || text.trim() === ""}>
          <Icon name="ArrowUp" className="size-4" />
          Send
        </Button>
      </div>
    </form>
  );
}

function AdoptForm({ api: { rpc, refetch }, onError }: { api: RosterApi; onError: (message: string) => void }) {
  const [threadId, setThreadId] = useState("");
  const [role, setRole] = useState<"coordinator" | "project-chief" | "architect">("project-chief");
  const [taskKey, setTaskKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    rpc
      .call("adopt", { threadId: threadId.trim(), role, projectId: null, taskKey: role === "architect" ? taskKey.trim() || null : null, reportsTo: null })
      .then((result) => {
        setNote([`${result.threadId} is now ${result.role === "coordinator" ? "the coordinator" : result.role === "architect" ? "a task architect" : "a project chief"}.`, ...result.warnings].join(" "));
        setThreadId("");
        setTaskKey("");
        refetch();
      }, (cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)));
  };
  return (
    <details className="mt-6 rounded-lg border border-border px-3 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Adopt an existing thread</summary>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
        <Input value={threadId} onChange={(event) => setThreadId(event.target.value)} placeholder="thr_…" aria-label="Thread id" className="w-40" />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as typeof role)}
          aria-label="Role"
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="coordinator">Coordinator</option>
          <option value="project-chief">Project chief</option>
          <option value="architect">Task architect</option>
        </select>
        {role === "architect" ? <Input value={taskKey} onChange={(event) => setTaskKey(event.target.value)} placeholder="DOT-12" aria-label="Task key" className="w-28" /> : null}
        <Button type="submit" variant="outline" disabled={threadId.trim() === "" || (role === "architect" && taskKey.trim() === "")}>
          Adopt
        </Button>
      </form>
      {note === null ? null : <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Same as <code>bb chief-mode adopt &lt;thread&gt; --role …</code>. The thread stays an ordinary thread; only its chief-mode metadata changes.
      </p>
    </details>
  );
}

export function ChiefPage() {
  const { rpc, roster, error, setError, refetch } = useRoster();
  const api = { rpc, refetch };
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-6 pt-3 md:px-5 md:pt-4">
        <div className="mb-3 flex items-center gap-2">
          <p className="flex-1 text-sm text-muted-foreground">
            Coordinator → project chiefs → tasks → architects. Every row is an ordinary thread; click to open it.
          </p>
          <Button variant="ghost" size="sm" onClick={refetch} aria-label="Refresh">
            <Icon name="ArrowReloadHorizontal" className="size-4" />
          </Button>
        </div>
        <CoordinatorComposer api={api} coordinatorId={roster?.coordinatorId ?? null} onError={setError} />
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4">
          {roster === null ? (
            <EmptyState>Loading the roster…</EmptyState>
          ) : roster.totals.members === 0 ? (
            <EmptyState>No threads hold a chief-mode role yet.</EmptyState>
          ) : (
            <ul className="overflow-hidden rounded-lg border border-border bg-card py-1" aria-label="Chief hierarchy">
              {roster.coordinators.map((coordinator) => (
                <MemberRow key={coordinator.threadId} member={coordinator} label="Coordinator" depth={0} />
              ))}
              {roster.projects.map((project) => (
                <ProjectRows key={project.projectId} project={project} />
              ))}
            </ul>
          )}
        </div>
        {roster === null ? null : (
          <p className="mt-2 text-xs text-muted-foreground">
            {roster.totals.members} members · {roster.totals.working} working · {roster.totals.pending} waiting on you
          </p>
        )}
        <AdoptForm api={api} onError={setError} />
      </div>
    </div>
  );
}

/** The nav entry's badge: how many members wait on a person. */
export function useChiefBadge() {
  const { roster } = useRoster();
  const pending = roster?.totals.pending ?? 0;
  return pending === 0 ? null : { count: pending, tone: "warning" as const, label: `${pending} chief-mode thread${pending === 1 ? "" : "s"} waiting on you` };
}
