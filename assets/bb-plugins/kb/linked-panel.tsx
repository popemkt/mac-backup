// bb-plugin-kb — linked items, the frontend half: the "kb canvases" thread side-panel tab. The kb canvases this
// thread, its project, or any thread wrote or linked, a search box, "Link open canvas", and a click that shows
// one in the kb tab. Deliberately the Canvases panel's twin (assets/bb-plugins/canvas-links/app.tsx): same
// tabs, same row anatomy, same actions where they apply, so the two can be compared day to day. Data comes
// from links.ts over RPC; the row rules are lib/links.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useBbNavigate, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { LinksAnswer, linksContract } from "./links";
import { matches, threadIds, timeLabel, type LinkedItem, type Scope } from "./lib/links";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const LINKED_PANEL = "kb-canvases";
export const LINKED_TITLE = "kb canvases";
/** The kb tab (app.tsx) an item opens in. */
const KB_PANEL = { actionId: "kb", title: "kb" };

const SCOPE_LABELS: Record<Scope, string> = { session: "Thread", project: "Project", all: "All" };
const EMPTY: Record<Scope, string> = {
  session: "No kb canvases linked from this thread yet. Canvases its agent writes link themselves; or open one in the kb tab and link it.",
  project: "No kb canvases linked from this project.",
  all: "No kb canvases linked anywhere yet.",
};

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function useLinks(threadId: string, scope: Scope) {
  const rpc = useRpc<typeof linksContract>();
  const [answer, setAnswer] = useState<LinksAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const load = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    rpc
      .call("links", { threadId, scope })
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

function ThreadChip({ id, title, isCurrent }: { id: string; title: string | null | undefined; isCurrent: boolean }) {
  const navigate = useBbNavigate();
  const label = isCurrent ? "this thread" : (title ?? id);
  return (
    <button
      type="button"
      title={isCurrent ? id : `Go to ${title ?? id}`}
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
  item,
  scope,
  threadId,
  titles,
  now,
  onOpen,
}: {
  item: LinkedItem;
  scope: Scope;
  threadId: string;
  titles: Record<string, string | null>;
  now: number;
  onOpen: (item: LinkedItem) => void;
}) {
  const ids = threadIds(item);
  const linkedByHand = item.threads.some(t => t.id === threadId && t.how === "linked");
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(item)}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(item);
          }
        }}
        title={item.id}
        className="group cursor-pointer space-y-1 rounded-md px-2 py-1.5 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-label={item.open ? "open in the kb tab" : undefined}
            className={cn("size-2 shrink-0 rounded-full", item.open ? "bg-success" : "bg-transparent")}
          />
          <span className={cn("min-w-0 flex-1 truncate text-sm", item.gone && "text-muted-foreground line-through")}>{item.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timeLabel(item, now)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 pl-4 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">kb · {item.store}</span>
          {linkedByHand ? <span className="shrink-0">· linked by hand</span> : null}
          {item.gone ? <span className="shrink-0 text-warning">deleted</span> : null}
        </div>
        {scope !== "session" && ids.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 pl-4">
            {ids.slice(0, 3).map(id => (
              <ThreadChip key={id} id={id} title={titles[id]} isCurrent={id === threadId} />
            ))}
            {ids.length > 3 ? <span className="text-[11px] text-muted-foreground">+{ids.length - 3} threads</span> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function LinkedPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof linksContract>();
  const navigate = useBbNavigate();
  const [scope, setScope] = useState<Scope>("session");
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState(false);
  const { answer, error, loading, refresh } = useLinks(threadId, scope);
  const search = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const items = useMemo(() => (answer?.items ?? []).filter(i => matches(i, query, answer?.titles)), [answer, query]);

  const linkOpen = () => {
    setLinking(true);
    rpc
      .call("linkOpen", { threadId })
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

  const open = (item: LinkedItem) => {
    if (item.gone) {
      toast.error(`${item.name} was deleted in kb.`);
      return;
    }
    rpc.call("openItem", { threadId, id: item.id }).then(
      r => {
        if (!r.ok) {
          toast.error(r.message);
          return;
        }
        // The kb tab shows it now, or as soon as the tab opens and says its session.
        navigate.openThreadPanel(KB_PANEL);
      },
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
            placeholder="Search kb canvases…  ( / )"
            aria-label="Search kb canvases"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={linkOpen} disabled={linking}>
          <Icon name={linking ? "Spinner" : "Plus"} className={cn("size-3.5", linking && "animate-spin")} /> Link open canvas
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {error !== null && (answer === null || answer.items.length === 0) ? (
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
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{query === "" ? EMPTY[scope] : "No kb canvas matches."}</p>
        ) : (
          <ul className="space-y-0.5">
            {items.map(i => (
              <Row key={i.key} item={i} scope={scope} threadId={threadId} titles={answer.titles} now={now} onOpen={open} />
            ))}
          </ul>
        )}
      </div>

      {error !== null && answer !== null && answer.items.length > 0 ? (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">kb unreachable: links as last read.</p>
      ) : null}
    </div>
  );
}
