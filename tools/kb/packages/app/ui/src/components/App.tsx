import { useCallback, useEffect, useState } from "react";
import { ThemeIcon } from "@/components/ui/theme-icon";
import { loadGraph } from "@/api/graph";
import { ensureLiveConnection } from "@/api/live";
import { CommandPalette, PaletteTrigger } from "@/components/palette/command-palette";
import { ViewFilterPopoverHost } from "@/components/outline/view-filter-popover";
import { PreferencesPopover } from "@/components/prefs/preferences-popover";
import { Sidebar } from "@/components/sidebar/sidebar";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { NotFound } from "@/components/ui/not-found";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { WorkspaceBoundary } from "@/components/ui/workspace-boundary";
import { matchGlobalShortcut } from "@/lib/keyboard-shortcuts";
import { useRoute, type Surface, type SurfaceParams } from "@/lib/plugins";
import type { Contribution } from "@kb/plugin";
import { OPTIONAL_UI_PLUGINS, startUiPlugins } from "@/ui-plugins";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, useSidebarToggle } from "@/stores/prefs.store";
import type { WsStatus } from "@/api/ws";
import { useUiStore } from "@/stores/ui.store";
import { cn } from "@/lib/cn";
import { hasText } from "@/lib/text";

// Every page, and the sidebar section that leads to it, is a plugin's
// contribution; the shell only frames whichever surface owns the path.
startUiPlugins();

/** Total over `WsStatus`: every status has a dot, so the lookup cannot miss. */
const WS_DOT: Record<WsStatus, { className: string; label: string }> = {
  open: { className: "bg-success", label: "live" },
  connecting: { className: "bg-warning", label: "connecting" },
  closed: { className: "bg-destructive", label: "offline" },
  idle: { className: "bg-foreground/25", label: "idle" },
};

function ConnectionDot() {
  const wsStatus = useUiStore((s) => s.wsStatus);
  const dot = WS_DOT[wsStatus];
  return (
    <span
      className="flex items-center gap-1.5 text-label text-foreground/40"
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
  return (
    <>
      <PreferencesPopover plugins={OPTIONAL_UI_PLUGINS} />
      <ViewFilterPopoverHost />
      <CommandPalette open={globalPaletteOpen} onClose={() => setGlobalPaletteOpen(false)} />
      <Toasts />
    </>
  );
}

/**
 * The one main region.
 *
 * It owns the scrollbar gutter, and reserves it whether or not this view
 * happens to overflow (`::-webkit-scrollbar` is 6px wide and therefore takes
 * layout width, see index.css). Without that, a long view had a scrollbar and
 * a short one did not, the content box changed width by 6px between them, and
 * the centered column — breadcrumb included — shifted ~3px. Fixing it here is
 * what keeps every downstream element free of compensating offsets.
 */
function MainRegion({
  scroll = true,
  children,
}: {
  /** Canvas owns its own viewport and deliberately does not scroll. */
  scroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cn(
        "min-h-0 flex-1",
        // `overflow-y: scroll`, not `auto` + `scrollbar-gutter: stable`. Both
        // reserve the 6px track so an overflowing view and a short one resolve
        // to the same content width (that width difference is what moved the
        // centered column, and the breadcrumb with it). Only this one works
        // everywhere: scrollbar-gutter needs Safari 18.2+.
        scroll ? "overflow-x-auto overflow-y-scroll" : "overflow-hidden",
      )}
      data-main-region={scroll ? "scroll" : "fixed"}
    >
      {children}
    </main>
  );
}

/** A surface's page, under whatever chrome it contributes. */
function SurfaceBody({
  surface,
  params,
}: {
  surface: Contribution<Surface>;
  params: SurfaceParams;
}) {
  const { Component } = surface.value;
  // A plugin's page owns its own boundary; this one only keeps a page that
  // lacks one from taking the shell down with it.
  return (
    <ViewErrorBoundary title="View crashed" resetKey={surface.id}>
      <Component params={params} />
    </ViewErrorBoundary>
  );
}

/** What the shell frames under its header: a surface's page, or the not-found state. */
interface ShellPage {
  readonly pendingTitle: string;
  readonly scroll: boolean;
  readonly chrome: React.ReactNode;
  readonly body: React.ReactNode;
}

function surfacePage(surface: Contribution<Surface>, params: SurfaceParams): ShellPage {
  const { Chrome } = surface.value;
  return {
    pendingTitle: surface.value.pendingTitle(params),
    scroll: surface.value.frame(params) === "scroll",
    chrome: Chrome === undefined ? null : <Chrome params={params} />,
    body: <SurfaceBody surface={surface} params={params} />,
  };
}

/** A path no surface owns. */
const NOT_FOUND_PAGE: ShellPage = {
  pendingTitle: "Opening your workspace…",
  scroll: true,
  chrome: null,
  body: <NotFound what="Page" back={{ label: "Home", path: "/" }} />,
};

function WorkspaceShell({
  status,
  error,
  onRetry,
  page,
}: {
  status: "loading" | "ready" | "error";
  error: string | null;
  onRetry: () => void;
  page: ShellPage;
}) {
  const theme = usePrefsStore((s) => s.theme);
  const rev = useOutlineStore((s) => s.rev);
  const loadSource = useOutlineStore((s) => s.loadSource);
  const prefsOpen = useUiStore((s) => s.prefsOpen);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  const setGlobalPaletteOpen = useUiStore((s) => s.setGlobalPaletteOpen);
  const sidebar = useSidebarToggle();

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
        <SidebarToggle {...sidebar} />
        <h1 className="text-ui font-medium text-foreground/50">kb</h1>
        <span className="text-label text-foreground/30">
          {status === "loading" ? "loading…" : `rev ${rev} · ${loadSource ?? "?"}`}
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
          <ThemeIcon theme={theme} size={15} />
        </button>
      </header>

      {status === "ready" ? page.chrome : null}

      <WorkspaceBoundary pending={status === "loading"} title={page.pendingTitle}>
        {status === "error" ? (
          <LoadError error={error} onRetry={onRetry} />
        ) : (
          <MainRegion scroll={page.scroll}>{page.body}</MainRegion>
        )}
      </WorkspaceBoundary>
    </div>
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
  const surface = route.contribution;

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

  const { Chrome } = surface?.value ?? {};
  return (
    <div className="relative flex h-full min-h-0">
      <SkipLink />
      <ViewErrorBoundary title="Sidebar crashed" resetKey="sidebar">
        <Sidebar />
      </ViewErrorBoundary>
      <div
        id={MAIN_ID}
        tabIndex={-1}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col outline-none"
      >
        {surface !== null && surface.value.frame(route.params) === "full" ? (
          <WorkspaceBoundary
            pending={status === "loading"}
            title={surface.value.pendingTitle(route.params)}
          >
            {status === "error" ? (
              <LoadError error={error} onRetry={() => void reload()} />
            ) : (
              <>
                {Chrome !== undefined ? <Chrome params={route.params} /> : null}
                <SurfaceBody surface={surface} params={route.params} />
              </>
            )}
          </WorkspaceBoundary>
        ) : (
          <WorkspaceShell
            status={status}
            error={error}
            onRetry={() => void reload()}
            page={surface === null ? NOT_FOUND_PAGE : surfacePage(surface, route.params)}
          />
        )}
        <SharedChrome />
      </div>
    </div>
  );
}
