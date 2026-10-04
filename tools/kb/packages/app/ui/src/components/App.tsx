import { useCallback, useEffect, useState } from "react";
import { cn, hasText, SidebarToggle, ThemeIcon, useRoute, ViewErrorBoundary } from "@kb/ui-sdk";
import { loadGraph } from "@/api/graph";
import { ensureLiveConnection } from "@/api/live";
import { CommandPalette, PaletteTrigger } from "@/components/palette/command-palette";
import { DockHost, DockToggles } from "@/docks";
import { ViewFilterPopoverHost } from "@/components/outline/view-filter-popover";
import { PreferencesPopover } from "@/components/prefs/preferences-popover";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Workspace } from "@/components/layout/workspace";
import { WorkspaceBoundary } from "@/components/ui/workspace-boundary";
import { matchGlobalShortcut } from "@/lib/keyboard-shortcuts";
import { loadManifest } from "@/lib/manifest";
import { startWorkspace, useWorkspaceStore } from "@/stores/workspace.store";
import { layoutPanes } from "@kb/views";
import {
  extensionsSettled,
  startUiPlugins,
  switchExtension,
  useExtensionSwitches,
} from "@/ui-plugins";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, useSidebarToggle } from "@/stores/prefs.store";
import type { WsStatus } from "@/api/ws";
import { useUiStore } from "@/stores/ui.store";

// Every page is a route to a plugin's view, and the sidebar section that
// leads to it is a contribution too; the shell only frames whichever route
// owns the path.
startUiPlugins();

/** Total over `WsStatus`: every status has a dot, so the lookup cannot miss. */
const WS_DOT: Record<WsStatus, { className: string; label: string }> = {
  open: { className: "bg-success", label: "live" },
  connecting: { className: "bg-warning", label: "connecting" },
  closed: { className: "bg-destructive", label: "offline" },
  idle: { className: "bg-foreground/25", label: "idle" },
};

/** Where the loaded graph came from, in words: the kb server, or the bundled fixtures. */
const LOAD_SOURCE: Record<"api" | "fixtures", string> = {
  api: "the kb server",
  fixtures: "sample data",
};

/**
 * Connection state in one plain word. The revision and the load source are
 * diagnostics, not status: they live in the tooltip, not in the header.
 */
function ConnectionDot() {
  const wsStatus = useUiStore((s) => s.wsStatus);
  const rev = useOutlineStore((s) => s.rev);
  const loadSource = useOutlineStore((s) => s.loadSource);
  const dot = WS_DOT[wsStatus];
  const source = loadSource === null ? "not loaded" : `from ${LOAD_SOURCE[loadSource]}`;
  return (
    <span
      className="flex items-center gap-1.5 text-label text-foreground/40"
      title={`Connection: ${dot.label} · revision ${rev}, ${source}`}
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
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          aria-label={`Dismiss notification: ${t.text}`}
          className={cn(
            "kb-surface-enter flex items-start gap-2 rounded-md border bg-popover px-3 py-2 text-left text-meta shadow-lifted",
            t.kind === "error"
              ? "border-destructive/40 text-destructive"
              : "border-foreground/10 text-popover-foreground",
          )}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.count > 1 ? (
            <span className="shrink-0 tabular-nums" aria-label={`${t.count} times`}>
              ×{t.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

const MAIN_ID = "kb-main";

/**
 * The first stop for Tab: past the sidebar straight to the page. It moves
 * focus without writing a `#fragment` into the URL, which the router owns.
 */
function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-1.5 focus:text-ui focus:text-popover-foreground focus:shadow-overlay"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(MAIN_ID)?.focus();
      }}
    >
      Skip to content
    </a>
  );
}

function SharedChrome() {
  const globalPaletteOpen = useUiStore((s) => s.globalPaletteOpen);
  const setGlobalPaletteOpen = useUiStore((s) => s.setGlobalPaletteOpen);
  const switches = useExtensionSwitches();
  return (
    <>
      <PreferencesPopover
        switches={switches}
        onSwitch={(name, on) => void switchExtension(name, on)}
      />
      <ViewFilterPopoverHost />
      <CommandPalette open={globalPaletteOpen} onClose={() => setGlobalPaletteOpen(false)} />
      <Toasts />
    </>
  );
}

/** The workspace header: the sidebar toggle, connection, palette, docks and preferences. */
function WorkspaceHeader({ status }: { status: "loading" | "ready" | "error" }) {
  const theme = usePrefsStore((s) => s.theme);
  const prefsOpen = useUiStore((s) => s.prefsOpen);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  const setGlobalPaletteOpen = useUiStore((s) => s.setGlobalPaletteOpen);
  const sidebar = useSidebarToggle();

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
      <SidebarToggle {...sidebar} />
      <h1 className="text-ui font-medium text-foreground/50">kb</h1>
      {status === "loading" ? (
        <span className="text-label text-foreground/30">loading…</span>
      ) : null}
      <ConnectionDot />
      <div className="flex-1" />
      <PaletteTrigger onOpen={() => setGlobalPaletteOpen(true)} />
      <DockToggles />
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70"
        aria-label="Preferences"
        title="Preferences"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setPrefsOpen(!prefsOpen)}
      >
        <ThemeIcon theme={theme} size={15} />
      </button>
    </header>
  );
}

function LoadError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-6" role="alert">
      <div>
        <h2 className="kb-text font-medium text-foreground/80">Couldn’t load your workspace</h2>
        <p className="mt-1 text-ui text-foreground/50">
          Check that kb is running, then try again. Your local data has not been changed.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-primary px-3 py-1.5 text-meta font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
        {hasText(error) ? (
          <details className="text-meta text-foreground/45">
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const route = useRoute();
  const panes = useWorkspaceStore((s) => layoutPanes(s.layout).length);
  // A lone page that takes the whole column (the graph) takes the header's place too.
  const header = panes > 1 || route === null || route.frame !== "full";

  // The URL names the focused pane: a navigation moves it.
  useEffect(() => startWorkspace(), []);

  const reload = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const { snapshot, source } = await loadGraph();
      hydrateFromWire(snapshot.nodes, snapshot.rev, source);
      // The page follows the server: ask which extensions and views it loaded,
      // and open the workspace only once their plugins are in, so a layout
      // never shows one of their views as unavailable on the way. Offline, the
      // page is its own server, and its own reading is already in.
      if (source === "api") {
        await loadManifest();
        await extensionsSettled();
      }
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
      const o = useOutlineStore.getState();
      const action = matchGlobalShortcut(e, {
        rowAnchored: o.activeNodeId !== null || o.selectedNodeId !== null,
      });
      if (action === null) return;
      e.preventDefault();
      if (action === "node-palette") {
        // An edited row is demoted to selected, so the palette anchors on it.
        if (o.activeNodeId !== null && o.activeInstanceKey !== null) {
          o.selectNode(o.activeNodeId, o.activeInstanceKey);
        }
        useUiStore.getState().setNodePaletteOpen(true);
        return;
      }
      setGlobalPaletteOpen(!useUiStore.getState().globalPaletteOpen);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [setGlobalPaletteOpen]);

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden">
      <SkipLink />
      <ViewErrorBoundary title="Sidebar crashed" resetKey="sidebar">
        <Sidebar />
      </ViewErrorBoundary>
      <div
        id={MAIN_ID}
        tabIndex={-1}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col outline-none"
      >
        {header ? <WorkspaceHeader status={status} /> : null}
        <WorkspaceBoundary
          pending={status === "loading"}
          title={route?.pendingTitle ?? "Opening your workspace…"}
        >
          {status === "error" ? (
            <LoadError error={error} onRetry={() => void reload()} />
          ) : (
            <Workspace />
          )}
        </WorkspaceBoundary>
        <SharedChrome />
      </div>
      <ViewErrorBoundary title="Dock crashed" resetKey="dock">
        <DockHost />
      </ViewErrorBoundary>
    </div>
  );
}
