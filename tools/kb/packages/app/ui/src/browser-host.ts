/**
 * The page's `BrowserHost` (DESIGN-UI.md → Extension UI halves), bound to the
 * shell's stores, write path, invoke path and sandbox host. A built-in plugin
 * provides it to the UI kernel. Feature plugins inject it, so they apply only
 * once it is there, and they reach the shell through it alone.
 */
import { definePlugin } from "@kb/plugin";
import { mutations } from "@/actions/mutations";
import { proposeView } from "@/lib/propose-view";
import { subscribeLiveQueryNode } from "@/lib/query-node";
import { BrowserHostService, type BrowserHost } from "@kb/ui-sdk";
import { hostSandboxFrame, invokeAsScript, isTrusted, setTrusted } from "@/lib/sandbox-host";
import { invoke } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";
import {
  appearanceIn,
  sidebarOpenIn,
  toggleSidebarFrom,
  usePrefsStore,
} from "@/stores/prefs.store";
import { nodeTextPort } from "@/stores/node-text-port";
import { refInkIn } from "@/stores/ref-ink";
import { paneScreenPort } from "@/stores/screen.store";
import { useUiStore } from "@/stores/ui.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

/** The stores the host's reads answer from. */
const SOURCES = [useOutlineStore, usePrefsStore, useUiStore] as const;

const host: BrowserHost = {
  // A node text port is what the shell binds its own text hosts through, so
  // the host is that port, listened to over every store its reads answer from.
  ...nodeTextPort,
  subscribe: (listener) => {
    const unsubscribes = SOURCES.map((store) => store.subscribe(listener));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  },
  node: (id) => useOutlineStore.getState().nodes.get(id),
  isActive: (nodeId, instanceKey) => {
    const { activeNodeId, activeInstanceKey } = useOutlineStore.getState();
    return activeNodeId === nodeId && activeInstanceKey === instanceKey;
  },
  wireNodes: () => useOutlineStore.getState().wireNodes,
  live: () => useUiStore.getState().wsStatus === "open",
  subscribeQuery: subscribeLiveQueryNode,
  appearance: () => appearanceIn(usePrefsStore.getState()),
  theme: () => usePrefsStore.getState().theme,
  prefsOpen: () => useUiStore.getState().prefsOpen,
  setPrefsOpen: (open) => useUiStore.getState().setPrefsOpen(open),
  sidebarOpen: sidebarOpenIn,
  toggleSidebar: toggleSidebarFrom,
  refInk: () => refInkIn(useOutlineStore.getState()),
  zoomTo: (id) => useOutlineStore.getState().zoomTo(id),
  activateNode: (nodeId, cursorPos, instanceKey) =>
    useOutlineStore.getState().activateNode(nodeId, cursorPos, instanceKey),
  navigatePane: (pane, path) => useWorkspaceStore.getState().navigatePane(pane, path),
  replaceField: (nodeId, fieldId, values) => mutations.replaceField(nodeId, fieldId, values),
  updateNodeContent: (nodeId, text) => mutations.updateNodeContent(nodeId, text),
  uploadAsset: (file) => mutations.uploadAsset(file),
  attachFileToNode: (nodeId, file) => mutations.attachFileToNode(nodeId, file),
  removeTag: (nodeId, tagId) => mutations.removeTag(nodeId, tagId),
  invoke,
  screen: paneScreenPort,
  proposeView,
  sandbox: { hostFrame: hostSandboxFrame, invokeAsScript, isTrusted, setTrusted },
};

export const browserHostUiPlugin = definePlugin({
  name: "host",
  apply: (ctx) => ctx.provide(BrowserHostService, host),
});
