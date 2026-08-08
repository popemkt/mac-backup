/**
 * Query page (W4): query nodes + a scratch EDN editor. Saved queries
 * (.kb/queries/*.edn) surface as query nodes under sys.queries — opening
 * one zooms the outline onto that node (the zoomed-query-node view, where
 * results render live). The scratch editor stays for one-off EDN.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getLiveClient } from "@/api/live";
import { runQuery } from "@/ds/query";
import { isQueryNode } from "@/lib/query-node";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { ResultsTable } from "./results-table";
import { ViewPanel } from "./view-panel";

const LIVE_SUB_ID = "query-page";

const PLACEHOLDER =
  '[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]';

/** Saved queries first (sys.queries children), then user #query nodes. */
export function listQueryNodes(nodes: Map<string, OutlineNode>): {
  saved: OutlineNode[];
  user: OutlineNode[];
} {
  const savedIds = nodes.get(SYSTEM_IDS.queriesRoot)?.children ?? [];
  const saved = savedIds
    .map((id) => nodes.get(id))
    .filter((n): n is OutlineNode => n !== undefined);
  const savedSet = new Set(savedIds);
  const user: OutlineNode[] = [];
  for (const n of nodes.values()) {
    if (savedSet.has(n.id) || n.id === SYSTEM_IDS.queriesRoot) continue;
    if (n.id === SYSTEM_IDS.queryTag) continue;
    if (isQueryNode(n)) user.push(n);
  }
  user.sort((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
  return { saved, user };
}

function QueryNodeList({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: OutlineNode[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-[13px] font-semibold text-stone-700">{title}</h2>
      {items.length === 0 ? (
        <p className="text-[12px] text-stone-400">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onOpen(n.id)}
                className="flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left text-[12px] text-teal-700 hover:bg-teal-50"
                title={n.id}
              >
                <span aria-hidden className="shrink-0 text-[11px]">
                  {"⌕"}
                </span>
                <span className="truncate font-mono">
                  {n.text || "(untitled)"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function QueryPage() {
  const queryDb = useOutlineStore((s) => s.queryDb);
  const nodes = useOutlineStore((s) => s.nodes);
  const wsStatus = useUiStore((s) => s.wsStatus);
  const pushToast = useUiStore((s) => s.pushToast);
  const setView = useUiStore((s) => s.setView);

  const [edn, setEdn] = useState("");
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<"local" | "live" | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  const { saved, user } = listQueryNodes(nodes);

  /** Zoomed-query-node view: expand + zoom in the outline. */
  const openQueryNode = useCallback(
    (id: string) => {
      const store = useOutlineStore.getState();
      const node = store.nodes.get(id);
      if (!node) return;
      if (node.collapsed) store.toggleCollapse(id);
      setView("outline");
      store.zoomTo(id);
    },
    [setView],
  );

  const runLocal = useCallback(
    (text: string) => {
      if (!queryDb) {
        setError("graph not loaded yet");
        return;
      }
      try {
        setRows(runQuery(queryDb, text));
        setError(null);
        setSource("local");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [queryDb],
  );

  const subscribeLive = useCallback(
    (text: string) => {
      getLiveClient().subscribe(LIVE_SUB_ID, text, (liveRows) => {
        if (!liveRef.current) return;
        setRows(liveRows);
        setError(null);
        setSource("live");
      });
    },
    [],
  );

  const run = useCallback(
    (text?: string) => {
      const q = (text ?? edn).trim();
      if (!q) return;
      if (live && wsStatus === "open") {
        subscribeLive(q);
      } else {
        runLocal(q);
      }
    },
    [edn, live, wsStatus, runLocal, subscribeLive],
  );

  // Live toggle: subscribe on enable, unsubscribe on disable/unmount.
  useEffect(() => {
    if (!live) return;
    const q = edn.trim();
    if (q) subscribeLive(q);
    return () => {
      getLiveClient().unsubscribe(LIVE_SUB_ID);
    };
    // resubscription on query change goes through run(), not this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, subscribeLive]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  };

  const liveDisabled = wsStatus !== "open";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4">
        <QueryNodeList
          title="Saved queries"
          items={saved}
          onOpen={openQueryNode}
        />
        <QueryNodeList
          title="Query nodes"
          items={user}
          onOpen={openQueryNode}
        />
        <div className="mt-2 border-t border-stone-200 pt-4">
          <ViewPanel />
        </div>
      </aside>

      <section className="flex min-h-0 flex-col gap-3">
        <textarea
          value={edn}
          onChange={(e) => setEdn(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          rows={5}
          className="w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-2 font-mono text-[13px] shadow-sm outline-none focus:border-teal-500"
          aria-label="Datalog query"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => run()}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-teal-700"
          >
            Run
          </button>
          <span className="text-[11px] text-stone-400">⌘⏎</span>
          <label
            className={`flex items-center gap-1.5 text-[12px] ${
              liveDisabled ? "text-stone-300" : "text-stone-600"
            }`}
            title={
              liveDisabled
                ? "live subscriptions need an open WS connection"
                : "run as a WS subscription; rows push on every change"
            }
          >
            <input
              type="checkbox"
              checked={live}
              disabled={liveDisabled}
              onChange={(e) => {
                setLive(e.target.checked);
                if (!e.target.checked) {
                  pushToast("info", "live subscription stopped");
                }
              }}
            />
            live (WS subscription)
          </label>
          {source && rows && (
            <span className="text-[11px] text-stone-400">
              {rows.length} row{rows.length === 1 ? "" : "s"} · {source}
            </span>
          )}
        </div>

        {error && (
          <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </pre>
        )}
        {rows && <ResultsTable rows={rows} />}
      </section>
    </div>
  );
}
