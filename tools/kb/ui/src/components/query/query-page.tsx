import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedQuery } from "@kb/protocol";
import { fetchSavedQueries } from "@/api/queries";
import { getLiveClient } from "@/api/live";
import { runQuery } from "@/ds/query";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { ResultsTable } from "./results-table";
import { ViewPanel } from "./view-panel";

const LIVE_SUB_ID = "query-page";

const PLACEHOLDER =
  '[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]';

export function QueryPage() {
  const queryDb = useOutlineStore((s) => s.queryDb);
  const wsStatus = useUiStore((s) => s.wsStatus);
  const pushToast = useUiStore((s) => s.pushToast);

  const [edn, setEdn] = useState("");
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<"local" | "live" | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    let cancelled = false;
    fetchSavedQueries()
      .then((qs) => {
        if (!cancelled) setSaved(qs);
      })
      .catch(() => {
        // offline / fixtures mode — saved queries simply unavailable
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const loadSaved = (q: SavedQuery) => {
    setEdn(q.edn.trim());
    run(q.edn.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  };

  const liveDisabled = wsStatus !== "open";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold text-stone-700">
          Saved queries
        </h2>
        {saved.length === 0 ? (
          <p className="text-[12px] text-stone-400">
            None found (.kb/queries/*.edn)
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {saved.map((q) => (
              <li key={q.name}>
                <button
                  type="button"
                  onClick={() => loadSaved(q)}
                  className="w-full truncate rounded px-2 py-1 text-left font-mono text-[12px] text-teal-700 hover:bg-teal-50"
                  title={q.edn}
                >
                  {q.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 border-t border-stone-200 pt-4">
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
