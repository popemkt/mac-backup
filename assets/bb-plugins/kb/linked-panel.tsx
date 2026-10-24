// bb-plugin-kb — linked items, the frontend half: the "kb canvases" thread side-panel tab. The kb canvases this
// thread, its project, or any thread wrote or linked, a search box, "Link open canvas", and a click that shows
// one in the kb tab. Deliberately the Canvases panel's twin (assets/bb-plugins/canvas-links/app.tsx), so the two
// can be compared day to day: the tabs, rows and search are one shared module (assets/bb-plugins/linked-items).
// Data comes from links.ts over RPC.
// GAP [[01M5QJFW217ZNBXHEX74VG7VYP]]: this shell (header, search box, link button, empty and error states) is
// still the Canvases panel's, copied: it is drawn with each plugin's own Button, Input and Icon, which import
// "@/…" and "@get-bb/plugin-sdk/app", and those resolve only inside a plugin's root, not in the shared folder.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useBbNavigate, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { LinksAnswer, linksContract } from "./links";
import { LinkedRow, ScopeTabs } from "../linked-items/row";
import { ago, matches, type LinkRow, type Scope } from "../linked-items/rows";
import { rowOf } from "./lib/links";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const LINKED_PANEL = "kb-canvases";
export const LINKED_TITLE = "kb canvases";
/** The kb tab (app.tsx) an item opens in. */
const KB_PANEL = { actionId: "kb", title: "kb" };

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

export function LinkedPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof linksContract>();
  const navigate = useBbNavigate();
  const [scope, setScope] = useState<Scope>("session");
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState(false);
  const { answer, error, loading, refresh } = useLinks(threadId, scope);
  const search = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const rows = useMemo(
    () => (answer?.items ?? []).map(i => rowOf(i, threadId)).filter(r => matches(r, query, answer?.titles)),
    [answer, query, threadId],
  );

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

  const open = (row: LinkRow) => {
    if (row.gone !== null) {
      toast.error(`${row.name} was deleted in kb.`);
      return;
    }
    rpc.call("openItem", { threadId, id: row.key }).then(
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
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{query === "" ? EMPTY[scope] : "No kb canvas matches."}</p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map(r => (
              <LinkedRow
                key={r.key}
                row={r}
                scope={scope}
                threadId={threadId}
                titles={answer.titles}
                now={now}
                onOpen={open}
                onThread={id => navigate.toThread(id)}
              />
            ))}
          </ul>
        )}
      </div>

      {error !== null && answer !== null && answer.items.length > 0 ? (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">kb unreachable: links as last read.</p>
      ) : answer?.incomplete != null ? (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground" title="kb's log was compacted past writes this panel had not read">
          May be incomplete: kb's log skipped ahead {ago(answer.incomplete, now)}.
        </p>
      ) : null}
    </div>
  );
}
