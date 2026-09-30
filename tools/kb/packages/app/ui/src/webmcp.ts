/**
 * The page's WebMCP tools: `@kb/webmcp`'s adapter, bound to this page. It is
 * a built-in plugin, so its tools live in the UI kernel's scope and leave
 * when it unloads. Where the browser has no `document.modelContext` (it ships
 * behind a Chrome flag or origin trial) it does nothing.
 *
 * Every call runs through the browser's one invoke path, which decides
 * whether it runs on the local replica or on the server. The registry is
 * cached per server process, so it can only change across a server restart,
 * which the page sees as the live socket opening again; a page restored from
 * the back-forward cache lists it again too.
 */
import { modelContextOf, webMcpPlugin } from "@kb/webmcp";
import { logWarn } from "@/lib/log";
import { invokeSettled } from "@/session/runtime";
import { useUiStore } from "@/stores/ui.store";

function whenManifestMayChange(listener: () => void): () => void {
  // The adapter lists the registry once when it starts, so the first time the
  // socket opens is not news; every later open is a server that may have restarted.
  let opened = useUiStore.getState().wsStatus === "open";
  const offSocket = useUiStore.subscribe((next, previous) => {
    if (next.wsStatus !== "open" || previous.wsStatus === "open") return;
    if (opened) listener();
    opened = true;
  });
  const onShow = (event: PageTransitionEvent): void => {
    if (event.persisted) listener();
  };
  window.addEventListener("pageshow", onShow);
  return () => {
    offSocket();
    window.removeEventListener("pageshow", onShow);
  };
}

function whenPageHides(listener: () => void): () => void {
  window.addEventListener("pagehide", listener);
  return () => window.removeEventListener("pagehide", listener);
}

export const webMcpUiPlugin = webMcpPlugin({
  modelContext: () => modelContextOf(globalThis.document),
  // A local write answers at once and is pushed after; a tool call reports
  // the server's answer, so an agent never hears success for a rejected write.
  invoke: async ({ id, input }) => (await invokeSettled(id, input)).settled,
  whenManifestMayChange,
  whenPageHides,
  report: (message) => logWarn(`[kb/webmcp] ${message}`),
});
