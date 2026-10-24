// bb-plugin-kb — the frontend: a thread side-panel tab that shows the person's kb page, and a header
// button that opens it. The page itself lives in the window's kb frames (frames.tsx), one per recently shown
// thread, so a thread switch does not load kb again; the tab is where its thread's frame is drawn. The framed
// page tells its embedder its tab session (kb DESIGN.md → Surfaces → Embedding the page); the frame hands
// that to the backend, so the thread's agent makes its kb calls in this tab. Nothing else crosses the frame:
// the agent's calls go to kb's server, never through the panel.
import { useEffect, useRef } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  useBbNavigate,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { frames, KbFrameHost, useFrames } from "./frames";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LINKED_PANEL, LINKED_TITLE, LinkedPanel } from "./linked-panel";

const PANEL_ACTION = "kb";
const PANEL_TITLE = "kb";

/**
 * The thread's kb tab: the place the window's frame for this thread is drawn over (frames.tsx), with the
 * tab's status and controls above it. Switching threads unmounts this, not the frame, so coming back finds
 * kb as it was left.
 */
function KbPanel({ threadId }: PluginThreadPanelProps) {
  const store = useFrames();
  const place = useRef<HTMLDivElement | null>(null);
  const config = store.config;
  const url = config?.url ?? null;
  const session = store.sessionOf(threadId);

  useEffect(() => {
    if (url === null || place.current === null) return;
    return frames.claim(threadId, place.current);
  }, [threadId, url]);

  if (config === null) return <p className="p-4 text-sm text-muted-foreground">Loading kb…</p>;
  if (url === null) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No kb page is configured. Set the kb plugin's page URL in Settings → Installed plugins, or{" "}
        <code>bb plugin config kb set url https://…</code>.
      </p>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2 text-xs text-muted-foreground">
        <span
          className={session === null ? "size-2 rounded-full bg-muted-foreground/40" : "size-2 rounded-full bg-success"}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">
          {session === null ? "kb has not said its tab yet: the agent's calls are made in no tab" : "The agent works in this tab"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5"
          aria-label="Reload kb"
          onClick={() => frames.reload(threadId)}
        >
          <Icon name="RotateCw" className="size-3.5" />
        </Button>
        <a className="inline-flex" href={url} target="_blank" rel="noreferrer" title="Open kb in a new tab">
          <Icon name="ExternalLink" className="size-3.5" />
        </a>
      </div>
      <div ref={place} className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <span className="text-xs text-muted-foreground">Loading kb…</span>
      </div>
    </div>
  );
}

function HeaderButton({ threadId }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const pluginId = experimental_usePluginId();
  const config = useFrames().config;

  // With auto-open on, a thread opens kb beside it the first time this window shows it; closing the tab
  // keeps it closed until the window is reloaded.
  useEffect(() => {
    if (config?.autoOpen !== true || config.url === null) return;
    const key = `${pluginId}:opened:${threadId}`;
    try {
      if (sessionStorage.getItem(key) !== null) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    navigate.openThreadPanel({ actionId: PANEL_ACTION, title: PANEL_TITLE });
  }, [config, navigate, pluginId, threadId]);

  return (
    <span title="Open kb beside this thread" className="inline-flex">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        aria-label="Open kb beside this thread"
        onClick={() => {
          if (!navigate.openThreadPanel({ actionId: PANEL_ACTION, title: PANEL_TITLE })) {
            toast.error("This view has no side panel.");
          }
        }}
      >
        <Icon name="Network" className="size-4" />
      </Button>
    </span>
  );
}

export default definePluginApp(app => {
  app.slots.threadPanelAction({
    id: PANEL_ACTION,
    title: PANEL_TITLE,
    icon: "Network",
    layout: "flush",
    component: KbPanel,
    run: ({ openPanel }) => {
      openPanel({ title: PANEL_TITLE });
    },
  });
  app.slots.threadPanelAction({
    id: LINKED_PANEL,
    title: LINKED_TITLE,
    icon: "Shapes",
    layout: "flush",
    component: LinkedPanel,
    run: ({ openPanel }) => {
      openPanel({ title: LINKED_TITLE });
    },
  });
  // The window's kb frames, which outlive the thread panel tabs that show them (frames.tsx).
  app.slots.experimental_appOverlay({ id: "kb-frames", component: KbFrameHost });
  app.slots.experimental_threadHeaderAction({
    id: "kb-open",
    title: PANEL_TITLE,
    component: HeaderButton,
  });
});
