// bb-plugin-canvas-links — the frontend. A thread side-panel tab, "Canvases": the tldraw canvases this thread, its
// project, or anyone linked; a search over every canvas (linked or not); select rows, then Link to this thread,
// Unlink or Open. The panel itself is shared with the kb canvases panel (assets/bb-plugins/linked-items/panel.tsx);
// this file only hands it the data source, from server.ts over RPC (which runs canvas-link), and its own controls.
import { useMemo } from "react";
import { definePluginApp, useBbNavigate, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ListAnswer, rpcContract } from "./server";
import { LinkedItemsPanel, type LinkedSource, type Listed, type PanelUi } from "../linked-items/panel";
import { rowOf, type Scope } from "./lib/canvases";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

const PANEL_ACTION = "canvases";
const PANEL_TITLE = "Canvases";
const EMPTY: Record<Scope, string> = {
  session: "No canvases linked from this thread yet. Agents link the boards they touch; or search for one and link it.",
  project: "No canvases linked from this project.",
  all: "No canvases linked anywhere yet.",
};
const UI: PanelUi = { Button, Input, Icon, notify: { success: m => toast.success(m), error: m => toast.error(m) } };

function listed(answer: ListAnswer): Listed {
  return {
    rows: (answer.listing?.canvases ?? []).map(rowOf),
    titles: Object.fromEntries(Object.entries(answer.threads).map(([id, t]) => [id, t.title])),
    error: answer.error,
    note: answer.listing?.central === "unreachable" ? "Central log unreachable: this machine's links only." : null,
  };
}

function CanvasesPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const source = useMemo<LinkedSource>(
    () => ({
      list: scope => rpc.call("list", { threadId, scope }).then(listed),
      available: () => rpc.call("available", { threadId }).then(listed),
      run: (action, rows) => rpc.call(action, { threadId, keys: rows.map(r => r.key) }),
    }),
    [rpc, threadId],
  );
  return (
    <LinkedItemsPanel
      threadId={threadId}
      source={source}
      ui={UI}
      noun={{ one: "canvas", many: "canvases" }}
      empty={EMPTY}
      openMany
      onThread={id => navigate.toThread(id)}
    />
  );
}

export default definePluginApp(app => {
  app.slots.threadPanelAction({
    id: PANEL_ACTION,
    title: PANEL_TITLE,
    icon: "Shapes",
    layout: "flush",
    component: CanvasesPanel,
    run: ({ openPanel }) => {
      openPanel({ title: PANEL_TITLE });
    },
  });
});
