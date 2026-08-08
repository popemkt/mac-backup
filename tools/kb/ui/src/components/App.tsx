import { useEffect, useState } from "react";
import { loadGraph } from "@/api/graph";
import { SearchBox } from "@/components/search-box";
import { NodePanel } from "@/components/node-panel";
import { OutlineEditor } from "@/components/outline/outline-editor";
import { ToastHost } from "@/components/toast-host";
import { useOutlineStore } from "@/stores/outline.store";

export function App() {
  const hydrateFromWire = useOutlineStore((s) => s.hydrateFromWire);
  const loadSource = useOutlineStore((s) => s.loadSource);
  const rev = useOutlineStore((s) => s.rev);
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
          <span className="text-[12px] text-stone-400">
            {status === "loading"
              ? "loading…"
              : `rev ${rev} · ${loadSource ?? "?"}`}
          </span>
        </div>
        <SearchBox />
      </header>

      {status === "error" ? (
        <div className="p-6 text-red-700">{error}</div>
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
      <ToastHost />
    </div>
  );
}
