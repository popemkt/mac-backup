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
 * the back-forward cache lists it again too. What is listed also follows the
 * approval policies, which are graph data, so a change to them lists again.
 */
import { modelContextOf, webMcpPlugin } from "@kb/webmcp";
import { approvalPoliciesOf } from "@kb/model";
import type { KbIndex } from "@kb/query"; // GAP [[01M1RXNP3EMV1ES85BVE9CXMYE]]
import { logWarn } from "@/lib/log";
import { invokeSettled } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

/** The replica's approval policies, as one comparable value. */
function policiesKey(index: KbIndex | null): string {
  return index === null ? "" : JSON.stringify(approvalPoliciesOf(index.allNodes()));
}

/** Fire `listener` when the replica's approval policies change; returns the unsubscribe. */
function whenPoliciesChange(listener: () => void): () => void {
  let generation = useOutlineStore.getState().index?.generation ?? -1;
  let key = policiesKey(useOutlineStore.getState().index);
  return useOutlineStore.subscribe(({ index }) => {
    // Only a change to the graph can change a policy; anything else is not read.
    if ((index?.generation ?? -1) === generation) return;
    generation = index?.generation ?? -1;
    const next = policiesKey(index);
    if (next === key) return;
    key = next;
    listener();
  });
}

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
  const offPolicies = whenPoliciesChange(listener);
  return () => {
    offSocket();
    offPolicies();
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
  invoke: async (invocation) => (await invokeSettled(invocation)).settled,
  whenManifestMayChange,
  whenPageHides,
  report: (message) => logWarn(`[kb/webmcp] ${message}`),
});
