// bb-plugin-canvas-links — the frontend. A thread side-panel tab, "Canvases": the tldraw canvases this thread, its
// project, or anyone linked, a search box, "Link focused canvas", and a click to open one. All data comes from
// server.ts over RPC (which runs canvas-link); the row rules live in lib/canvases.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { definePluginApp, useBbNavigate, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ListAnswer, rpcContract, ThreadRef } from "./server";
import { matches, otherHarnesses, threadIds, timeLabel, type Canvas, type Scope } from "./lib/canvases";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PANEL_ACTION = "canvases";
const PANEL_TITLE = "Canvases";
const SCOPE_LABELS: Record<Scope, string> = { session: "Thread", project: "Project", all: "All" };
const EMPTY: Record<Scope, string> = {
  session: "No canvases linked from this thread yet. Agents link the boards they touch; or focus one in tldraw and link it.",
  project: "No canvases linked from this project.",
  all: "No canvases linked anywhere yet.",
};

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function useListing(threadId: string, scope: Scope) {
  const rpc = useRpc<typeof rpcContract>();
  const [answer, setAnswer] = useState<ListAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const load = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    rpc
      .call("list", { threadId, scope })
      .then(
        next => {
          if (mine !== generation.current) return;
          setAnswer(next);
          setError(next.error);
        },
        cause => mine === generation.current && setError(message(cause)),
      )
      .finally(() => mine === generation.current && setLoading(false));
  }, [rpc, threadId, scope]);
  useEffect(() => {
    setAnswer(null);
    load();
  }, [load]);
  return { answer, error, loading, refresh: load };
}

function ScopeTab({ scope, current, onSelect }: { scope: Scope; current: Scope; onSelect: (s: Scope) => void }) {
  const isOn = scope === current;
  return (
    <button
      type="button"
      aria-pressed={isOn}
      onClick={() => onSelect(scope)}
      className={cn(
        "flex-1 cursor-pointer rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isOn ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      {SCOPE_LABELS[scope]}
    </button>
  );
}

function ThreadChip({ id, thread, isCurrent }: { id: string; thread: ThreadRef | undefined; isCurrent: boolean }) {
  const navigate = useBbNavigate();
  const label = isCurrent ? "this thread" : (thread?.title ?? id);
  return (
    <button
      type="button"
      title={isCurrent ? id : `Go to ${thread?.title ?? id}`}
      disabled={isCurrent}
      onClick={event => {
        event.stopPropagation();
        navigate.toThread(id);
      }}
      className={cn(
        "max-w-40 truncate rounded border border-border px-1.5 py-px text-[11px] leading-4",
        isCurrent ? "text-muted-foreground" : "cursor-pointer text-foreground hover:bg-state-hover",
      )}
    >
      {label}
    </button>
  );
}

function Row({
  canvas,
  scope,
  threadId,
  threads,
  now,
  onOpen,
}: {
  canvas: Canvas;
  scope: Scope;
  threadId: string;
  threads: Record<string, ThreadRef>;
  now: number;
  onOpen: (c: Canvas) => void;
}) {
  const ids = threadIds(canvas);
  const others = otherHarnesses(canvas);
  const missing = canvas.local && canvas.exists === false;
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(canvas)}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(canvas);
          }
        }}
        title={canvas.path ?? canvas.key}
        className="group cursor-pointer space-y-1 rounded-md px-2 py-1.5 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-label={canvas.open ? "open now" : undefined}
            className={cn("size-2 shrink-0 rounded-full", canvas.open ? "bg-success" : "bg-transparent")}
          />
          <span className={cn("min-w-0 flex-1 truncate text-sm", missing && "text-muted-foreground line-through")}>{canvas.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timeLabel(canvas, now)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 pl-4 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{canvas.local ? (canvas.folder ?? "") : `on ${canvas.host}`}</span>
          {missing ? <span className="shrink-0 text-warning">file gone</span> : null}
        </div>
        {scope !== "session" && (ids.length > 0 || others.length > 0) ? (
          <div className="flex flex-wrap items-center gap-1 pl-4">
            {ids.slice(0, 3).map(id => (
              <ThreadChip key={id} id={id} thread={threads[id]} isCurrent={id === threadId} />
            ))}
            {ids.length > 3 ? <span className="text-[11px] text-muted-foreground">+{ids.length - 3} threads</span> : null}
            {others.map(h => (
              <span key={h} className="rounded bg-muted px-1.5 py-px text-[11px] leading-4 text-muted-foreground">
                {h}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CanvasesPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [scope, setScope] = useState<Scope>("session");
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState(false);
  const { answer, error, loading, refresh } = useListing(threadId, scope);
  const search = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const canvases = useMemo(() => (answer?.listing?.canvases ?? []).filter(c => matches(c, query)), [answer, query]);

  const linkFocused = () => {
    setLinking(true);
    rpc
      .call("linkFocused", { threadId })
      .then(
        r => {
          if (r.ok) {
            toast.success(r.message);
            refresh();
          } else toast.error(r.message);
        },
        cause => toast.error(message(cause)),
      )
      .finally(() => setLinking(false));
  };

  const open = (c: Canvas) => {
    rpc.call("open", { threadId, key: c.key, host: c.host }).then(
      r => (r.ok ? refresh() : toast.error(r.message)),
      cause => toast.error(message(cause)),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const isTyping = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      search.current?.focus();
    }
  };

  const central = answer?.listing?.central;

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="flex flex-1 items-center gap-0.5 rounded-lg bg-muted/50 p-0.5" role="toolbar" aria-label="Scope">
            {(["session", "project", "all"] as const).map(s => (
              <ScopeTab key={s} scope={s} current={scope} onSelect={setScope} />
            ))}
          </div>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={refresh} disabled={loading} aria-label="Refresh">
            <Icon name="RotateCcw" className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="relative">
          <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={search}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape" && query !== "") {
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search canvases…  ( / )"
            aria-label="Search canvases"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={linkFocused} disabled={linking}>
          <Icon name={linking ? "Spinner" : "Plus"} className={cn("size-3.5", linking && "animate-spin")} /> Link focused canvas
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {error !== null ? (
          <div role="alert" className="mx-1.5 space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : answer === null ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Icon name="Spinner" className="size-4 animate-spin" /> Reading links…
          </div>
        ) : canvases.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{query === "" ? EMPTY[scope] : "No canvas matches."}</p>
        ) : (
          <ul className="space-y-0.5">
            {canvases.map(c => (
              <Row key={c.key} canvas={c} scope={scope} threadId={threadId} threads={answer.threads} now={now} onOpen={open} />
            ))}
          </ul>
        )}
      </div>

      {central === "unreachable" ? (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">Central log unreachable: this machine's links only.</p>
      ) : null}
    </div>
  );
}

export default definePluginApp(app => {
  app.slots.threadPanelAction({
    id: PANEL_ACTION,
    title: PANEL_TITLE,
    icon: "Shapes",
    layout: "flush",
    component: CanvasesPanel,
    run: ({ openPanel }) => {
      openPanel({ title: PANEL_TITLE });
    },
  });
});
