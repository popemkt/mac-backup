import { useEffect, useState } from "react";
import { CircleHalf } from "@phosphor-icons/react";
import { loadGraph } from "@/api/graph";
import { ensureLiveConnection } from "@/api/live";
import {
  CommandPalette,
  PaletteTrigger,
} from "@/components/palette/command-palette";
import { OutlineEditor } from "@/components/outline/outline-editor";
import { PreferencesPopover } from "@/components/prefs/preferences-popover";
import { matchGlobalShortcut } from "@/lib/keyboard-shortcuts";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { cn } from "@/lib/cn";

const WS_DOT: Record<string, { className: string; label: string }> = {
  open: { className: "bg-success", label: "live" },
  connecting: { className: "bg-warning", label: "connecting" },
  closed: { className: "bg-destructive", label: "offline" },
  idle: { className: "bg-foreground/25", label: "idle" },
};

function ConnectionDot() {
  const wsStatus = useUiStore((s) => s.wsStatus);
  const dot = WS_DOT[wsStatus] ?? WS_DOT.idle!;
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] text-foreground/40"
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
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-foreground/10 bg-popover text-foreground/70",
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const hydrateFromWire = useOutlineStore((s) => s.hydrateFromWire);
  const loadSource = useOutlineStore((s) => s.loadSource);
  const rev = useOutlineStore((s) => s.rev);
  const width = usePrefsStore((s) => s.width);
  const prefsOpen = useUiStore((s) => s.prefsOpen);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const globalPaletteOpen = useUiStore((s) => s.globalPaletteOpen);
  const setGlobalPaletteOpen = useUiStore((s) => s.setGlobalPaletteOpen);
  const setNodePaletteOpen = useUiStore((s) => s.setNodePaletteOpen);

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = matchGlobalShortcut(e);
      if (!action) return;
      e.preventDefault();
      if (action === "global-search") {
        setGlobalPaletteOpen(!useUiStore.getState().globalPaletteOpen);
        return;
      }
      const { activeNodeId, selectNode } = useOutlineStore.getState();
      if (activeNodeId) selectNode(activeNodeId);
      setNodePaletteOpen(!useUiStore.getState().nodePaletteOpen);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [setGlobalPaletteOpen, setNodePaletteOpen]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
        <h1 className="text-[13px] font-medium text-foreground/50">kb</h1>
        <span className="text-[11px] text-foreground/30">
          {status === "loading"
            ? "loading…"
            : `rev ${rev} · ${loadSource ?? "?"}`}
        </span>
        <ConnectionDot />
        <div className="flex-1" />
        <PaletteTrigger onOpen={() => setGlobalPaletteOpen(true)} />
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70"
          aria-label="Preferences"
          title="Preferences"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPrefsOpen(!prefsOpen)}
        >
          <CircleHalf size={15} />
        </button>
      </header>

      {status === "error" ? (
        <div className="p-6 text-destructive">{error}</div>
      ) : (
        <main className="min-h-0 flex-1 overflow-auto">
          <div
            className={cn(
              "kb-shell w-full",
              width === "centered" ? "mx-auto max-w-3xl px-4" : "px-8",
            )}
          >
            <OutlineEditor />
          </div>
        </main>
      )}

      <PreferencesPopover />
      <CommandPalette
        open={globalPaletteOpen}
        onClose={() => setGlobalPaletteOpen(false)}
      />
      <Toasts />
    </div>
  );
}
