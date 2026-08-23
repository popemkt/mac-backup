import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { CircleHalf } from "@phosphor-icons/react";
import { loadGraph } from "@/api/graph";
import { ensureLiveConnection } from "@/api/live";
import {
  CommandPalette,
  PaletteTrigger,
} from "@/components/palette/command-palette";
import { OutlineEditor } from "@/components/outline/outline-editor";
import { ViewFilterPopoverHost } from "@/components/outline/view-filter-popover";
import { PreferencesPopover } from "@/components/prefs/preferences-popover";
import { Sidebar, SidebarToggle } from "@/components/sidebar/sidebar";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { matchGlobalShortcut } from "@/lib/keyboard-shortcuts";
import { matchRoute, usePath } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { cn } from "@/lib/cn";

/** Sigma/graphology and canvas land in separate chunks — outline bundle must not grow. */
const GraphPage = lazy(() => import("@/components/graph/graph-page"));
const CanvasListPage = lazy(() =>
  import("@/components/canvas/canvas-list-page").then((m) => ({
    default: m.CanvasListPage,
  })),
);
const CanvasPage = lazy(() =>
  import("@/components/canvas/canvas-page").then((m) => ({
    default: m.CanvasPage,
  })),
);

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

function SharedChrome() {
  const globalPaletteOpen = useUiStore((s) => s.globalPaletteOpen);
  const setGlobalPaletteOpen = useUiStore((s) => s.setGlobalPaletteOpen);
  return (
    <>
      <PreferencesPopover />
      <ViewFilterPopoverHost />
      <CommandPalette
        open={globalPaletteOpen}
        onClose={() => setGlobalPaletteOpen(false)}
      />
      <Toasts />
    </>
  );
}

function OutlineShell({
  status,
  error,
  onRetry,
  canvasId = null,
  onCanvas = false,
}: {
  status: "loading" | "ready" | "error";
  error: string | null;
  onRetry: () => void;
  canvasId?: string | null;
  onCanvas?: boolean;
}) {
  const rev = useOutlineStore((s) => s.rev);
  const loadSource = useOutlineStore((s) => s.loadSource);
  const width = usePrefsStore((s) => s.width);
  const prefsOpen = useUiStore((s) => s.prefsOpen);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  const setGlobalPaletteOpen = useUiStore((s) => s.setGlobalPaletteOpen);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
        <SidebarToggle />
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
        <LoadError error={error} onRetry={onRetry} />
      ) : onCanvas ? (
        <main className="min-h-0 flex-1 overflow-hidden">
          <ViewErrorBoundary
            title="Canvas crashed"
            resetKey={canvasId ?? "canvas-list"}
          >
            <Suspense
              fallback={
                <div className="p-6 text-[13px] text-foreground/40">
                  Loading canvas…
                </div>
              }
            >
              {canvasId ? (
                <CanvasPage canvasId={canvasId} />
              ) : (
                <CanvasListPage />
              )}
            </Suspense>
          </ViewErrorBoundary>
        </main>
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
    </div>
  );
}

function LoadError({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-6" role="alert">
      <div>
        <h2 className="text-[14.5px] font-medium text-foreground/80">
          Couldn’t load your workspace
        </h2>
        <p className="mt-1 text-[13px] text-foreground/50">
          Check that kb is running, then try again. Your local data has not been changed.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
        {error ? (
          <details className="text-[12px] text-foreground/45">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="mt-1 max-w-sm overflow-auto whitespace-pre-wrap text-destructive/80">
              {error}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function App() {
  const hydrateFromWire = useOutlineStore((s) => s.hydrateFromWire);
  const setGlobalPaletteOpen = useUiStore((s) => s.setGlobalPaletteOpen);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const path = usePath();
  const route = matchRoute(path);

  const reload = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const { snapshot, source } = await loadGraph();
      hydrateFromWire(snapshot.nodes, snapshot.rev, source);
      setStatus("ready");
      ensureLiveConnection();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [hydrateFromWire]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = matchGlobalShortcut(e);
      if (!action) return;
      e.preventDefault();
      setGlobalPaletteOpen(!useUiStore.getState().globalPaletteOpen);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [setGlobalPaletteOpen]);

  return (
    <div className="relative flex h-full min-h-0">
      <Sidebar />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {route.name === "graph" ? (
          status === "loading" ? (
            <div className="p-6 text-[13px] text-foreground/40">loading…</div>
          ) : status === "error" ? (
            <LoadError error={error} onRetry={() => void reload()} />
          ) : (
            <ViewErrorBoundary
              title="Graph crashed"
              resetKey={route.perspectiveId ?? "graph"}
            >
              <Suspense
                fallback={
                  <div className="p-6 text-[13px] text-foreground/40">
                    loading graph…
                  </div>
                }
              >
                <GraphPage perspectiveId={route.perspectiveId} />
              </Suspense>
            </ViewErrorBoundary>
          )
        ) : (
          <OutlineShell
            status={status}
            error={error}
            onRetry={() => void reload()}
            canvasId={route.name === "canvas" ? route.id : null}
            onCanvas={route.name === "canvas-list" || route.name === "canvas"}
          />
        )}
        <SharedChrome />
      </div>
    </div>
  );
}
