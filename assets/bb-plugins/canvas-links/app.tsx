// bb-plugin-canvas-links — the frontend. A thread side-panel tab, "Canvases": the tldraw canvases this thread, its
// project, or anyone linked, a search box, "Link focused canvas", and a click to open one. All data comes from
// server.ts over RPC (which runs canvas-link); a canvas becomes a row in lib/canvases.ts, and the tabs, rows and
// search are shared with the kb canvases panel (assets/bb-plugins/linked-items).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { definePluginApp, useBbNavigate, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ListAnswer, rpcContract } from "./server";
import { LinkedRow, ScopeTabs } from "../linked-items/row";
import { matches } from "../linked-items/rows";
import { rowOf, type Scope } from "./lib/canvases";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PANEL_ACTION = "canvases";
const PANEL_TITLE = "Canvases";
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

function CanvasesPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [scope, setScope] = useState<Scope>("session");
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState(false);
  const { answer, error, loading, refresh } = useListing(threadId, scope);
  const search = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const titles = useMemo(
    () => Object.fromEntries(Object.entries(answer?.threads ?? {}).map(([id, t]) => [id, t.title ?? null])),
    [answer],
  );
  const canvases = useMemo(() => {
    const listed = answer?.listing?.canvases ?? [];
    return listed.map(c => ({ canvas: c, row: rowOf(c) })).filter(({ row }) => matches(row, query, titles));
  }, [answer, query, titles]);

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

  const open = (c: { key: string; host: string }) => {
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
          <ScopeTabs current={scope} onSelect={setScope} />
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
            {canvases.map(({ canvas, row }) => (
              <LinkedRow
                key={row.key}
                row={row}
                scope={scope}
                threadId={threadId}
                titles={titles}
                now={now}
                onOpen={() => open(canvas)}
                onThread={id => navigate.toThread(id)}
              />
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
