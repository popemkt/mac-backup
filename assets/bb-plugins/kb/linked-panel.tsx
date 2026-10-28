// bb-plugin-kb — linked items, the frontend half: the "kb canvases" thread side-panel tab. The kb canvases this
// thread, its project, or any thread wrote or linked; a search over every kb canvas (linked or not); select rows,
// then Link to this thread, Unlink, or Open one in the kb tab. The panel is the Canvases panel's own
// (assets/bb-plugins/linked-items/panel.tsx), so the two work alike: this file hands it the data source, from
// links.ts over RPC, and this plugin's controls.
import { useMemo, useRef } from "react";
import { useBbNavigate, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { LinksAnswer, linksContract } from "./links";
import { LinkedItemsPanel, type LinkedSource, type Listed, type PanelUi } from "../linked-items/panel";
import { ago, type Scope } from "../linked-items/rows";
import { rowOf } from "./lib/links";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

export const LINKED_PANEL = "kb-canvases";
export const LINKED_TITLE = "kb canvases";
/** The kb tab (app.tsx) an item opens in. */
const KB_PANEL = { actionId: "kb", title: "kb" };

const EMPTY: Record<Scope, string> = {
  session: "No kb canvases linked from this thread yet. Canvases its agent writes link themselves; or search for one and link it.",
  project: "No kb canvases linked from this project.",
  all: "No kb canvases linked anywhere yet.",
};
const UI: PanelUi = { Button, Input, Icon, notify: { success: m => toast.success(m), error: m => toast.error(m) } };

function listed(answer: LinksAnswer, threadId: string): Listed {
  return {
    rows: answer.items.map(i => rowOf(i, threadId)),
    titles: answer.titles,
    error: answer.error,
    note:
      answer.incomplete !== null ? (
        <span title="kb's log was compacted past writes this panel had not read">
          May be incomplete: kb's log skipped ahead {ago(answer.incomplete, Date.now())}.
        </span>
      ) : null,
  };
}

export function LinkedPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof linksContract>();
  const navigate = useBbNavigate();
  // Read at the time of an Open: the source stays the same object across renders, so the panel does not re-read.
  const nav = useRef(navigate);
  nav.current = navigate;
  const source = useMemo<LinkedSource>(
    () => ({
      list: scope => rpc.call("links", { threadId, scope }).then(a => listed(a, threadId)),
      available: () => rpc.call("available", { threadId }).then(a => listed(a, threadId)),
      run: async (action, rows) => {
        if (action !== "open") return rpc.call(action, { threadId, ids: rows.map(r => r.key) });
        const r = await rpc.call("openItem", { threadId, id: rows[0].key });
        // The kb tab shows it now, or as soon as the tab opens and says its session.
        if (r.ok) nav.current.openThreadPanel(KB_PANEL);
        return r;
      },
    }),
    [rpc, threadId],
  );
  return (
    <LinkedItemsPanel
      threadId={threadId}
      source={source}
      ui={UI}
      noun={{ one: "kb canvas", many: "kb canvases" }}
      empty={EMPTY}
      openMany={false}
      onThread={id => navigate.toThread(id)}
    />
  );
}
