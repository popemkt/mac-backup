import { useEffect, useState } from "react";
import { loadGraph } from "@/api/graph";
import { ensureLiveConnection } from "@/api/live";
import { SearchBox } from "@/components/search-box";
import { NodePanel } from "@/components/node-panel";
import { OutlineEditor } from "@/components/outline/outline-editor";
import { QueryPage } from "@/components/query/query-page";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore, type AppView } from "@/stores/ui.store";
import { cn } from "@/lib/cn";

const WS_DOT: Record<string, { className: string; label: string }> = {
  open: { className: "bg-emerald-500", label: "live" },
  connecting: { className: "bg-amber-400", label: "connecting" },
  closed: { className: "bg-red-400", label: "offline" },
  idle: { className: "bg-stone-300", label: "idle" },
};

function ConnectionDot() {
  const wsStatus = useUiStore((s) => s.wsStatus);
  const dot = WS_DOT[wsStatus] ?? WS_DOT.idle!;
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] text-stone-400"
      title={`WebSocket: ${wsStatus}`}
    >
      <span className={cn("h-2 w-2 rounded-full", dot.className)} />
      {dot.label}
    </span>
  );
}

function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cn(
            "rounded-md border px-3 py-2 text-left text-[12px] shadow-md",
            t.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-stone-200 bg-white text-stone-600",
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

function TabButton({ view, label }: { view: AppView; label: string }) {
  const active = useUiStore((s) => s.view === view);
  const setView = useUiStore((s) => s.setView);
  return (
    <button
      type="button"
      onClick={() => setView(view)}
      className={cn(
        "rounded-md px-2.5 py-1 text-[13px]",
        active
          ? "bg-stone-900 font-medium text-white"
          : "text-stone-500 hover:bg-stone-100",
      )}
    >
      {label}
    </button>
  );
}

export function App() {
  const hydrateFromWire = useOutlineStore((s) => s.hydrateFromWire);
  const loadSource = useOutlineStore((s) => s.loadSource);
  const rev = useOutlineStore((s) => s.rev);
  const view = useUiStore((s) => s.view);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { snapshot, source } = await loadGraph();
        if (cancelled) return;
        hydrateFromWire(snapshot.nodes, snapshot.rev, source);
        setStatus("ready");
        // Graph is in; go live. Fixture mode still tries — the dot just
        // shows offline while backoff retries in the background.
        ensureLiveConnection();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateFromWire]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-stone-200/70 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight text-stone-900">
            kb
          </h1>
          <nav className="flex items-center gap-1">
            <TabButton view="outline" label="Outline" />
            <TabButton view="query" label="Query" />
          </nav>
          <span className="text-[12px] text-stone-400">
            {status === "loading"
              ? "loading…"
              : `rev ${rev} · ${loadSource ?? "?"}`}
          </span>
          <ConnectionDot />
        </div>
        <SearchBox />
      </header>

      {status === "error" ? (
        <div className="p-6 text-red-700">{error}</div>
      ) : view === "query" ? (
        <QueryPage />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <main className="min-h-0 overflow-auto px-4 pt-2">
            <OutlineEditor />
          </main>
          <div className="hidden min-h-0 lg:block">
            <NodePanel />
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
