/**
 * The page's `BrowserHost` (DESIGN-UI.md → Extension UI halves), bound to the
 * shell's stores, write path, invoke path and sandbox host. A built-in plugin
 * provides it to the UI kernel. Feature plugins inject it, so they apply only
 * once it is there, and they reach the shell through it alone.
 */
import { definePlugin } from "@kb/plugin";
import { mutations } from "@/actions/mutations";
import { proposeView } from "@/lib/propose-view";
import { BrowserHostService, type BrowserHost } from "@/sdk/host";
import { useOutlineStore } from "@/stores/outline.store";
import { appearanceIn, usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

/** The stores the host's reads answer from. */
const SOURCES = [useOutlineStore, usePrefsStore, useUiStore] as const;

const host: BrowserHost = {
  subscribe: (listener) => {
    const unsubscribes = SOURCES.map((store) => store.subscribe(listener));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  },
  node: (id) => useOutlineStore.getState().nodes.get(id),
  index: () => useOutlineStore.getState().index,
  live: () => useUiStore.getState().wsStatus === "open",
  appearance: () => appearanceIn(usePrefsStore.getState()),
  navigatePane: (pane, path) => useWorkspaceStore.getState().navigatePane(pane, path),
  replaceField: (nodeId, fieldId, values) => mutations.replaceField(nodeId, fieldId, values),
  proposeView,
};

export const browserHostUiPlugin = definePlugin({
  name: "host",
  apply: (ctx) => ctx.provide(BrowserHostService, host),
});
