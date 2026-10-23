// bb-plugin-kb — the frontend: a thread side-panel tab that frames the person's kb page, and a header
// button that opens it. The framed page tells its embedder its tab session (kb DESIGN.md → Surfaces →
// Embedding the page); the panel hands that to the backend, so the thread's agent makes its kb calls in this
// tab. Nothing else crosses the frame: the agent's calls go to kb's server, never through the panel.
import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  useBbNavigate,
  useRpc,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { originOf, SESSION_HEARTBEAT_MS, sessionOfMessage } from "./lib/kb";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const PANEL_ACTION = "kb";
const PANEL_TITLE = "kb";

type Config = { readonly url: string | null; readonly autoOpen: boolean };

/** The backend's config, read once per mount. */
function useConfig(): Config | null {
  const rpc = useRpc<typeof rpcContract>();
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    let current = true;
    rpc.call("config", {}).then(
      next => current && setConfig(next),
      () => current && setConfig({ url: null, autoOpen: false }),
    );
    return () => {
      current = false;
    };
  }, [rpc]);
  return config;
}

function KbPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const config = useConfig();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const url = config?.url ?? null;
  const origin = url === null ? null : originOf(url);

  // The framed page posts its session once it knows the origins allowed to frame it, and again when its id
  // is renewed. Only a message from this panel's own frame, from kb's origin, is taken.
  useEffect(() => {
    if (origin === null) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const next = sessionOfMessage(event.data);
      if (next !== null) setSession(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  // Report the session while the panel shows it, repeated so the backend lets it lapse once the panel is
  // gone without saying so; say so when it goes.
  useEffect(() => {
    if (session === null) return;
    const report = () => void rpc.call("reportSession", { threadId, session }).catch(() => undefined);
    report();
    const timer = setInterval(report, SESSION_HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      void rpc.call("reportSession", { threadId, session: null }).catch(() => undefined);
    };
  }, [rpc, threadId, session]);

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
          onClick={() => {
            setSession(null);
            if (frame.current !== null) frame.current.src = url;
          }}
        >
          <Icon name="RotateCw" className="size-3.5" />
        </Button>
        <a className="inline-flex" href={url} target="_blank" rel="noreferrer" title="Open kb in a new tab">
          <Icon name="ExternalLink" className="size-3.5" />
        </a>
      </div>
      <iframe
        ref={frame}
        src={url}
        title="kb"
        className="min-h-0 w-full flex-1 border-0 bg-background"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}

function HeaderButton({ threadId }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const pluginId = experimental_usePluginId();
  const config = useConfig();

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
  app.slots.experimental_threadHeaderAction({
    id: "kb-open",
    title: PANEL_TITLE,
    component: HeaderButton,
  });
});
