// restart-resume's frontend: why a thread's last turn stopped, at a glance. Three registrations,
// one store (adapter/store.ts):
//   - a content script, only to hold bb's sidebar row-status setter for this generation;
//   - an invisible app overlay (adapter/sync.tsx), mounted once per window, which fetches stops
//     over RPC, refetches on the server's `stops` signal, and draws them on the sidebar rows;
//   - a thread header badge (adapter/badge.tsx) with the details.
// What a stop means and how it reads lives in core/stops.ts.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { StopBadge } from "./adapter/badge.tsx";
import { setRowStatusSetter } from "./adapter/store.ts";
import { StopsSync } from "./adapter/sync.tsx";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "stop-rows",
    mount({ experimental_setThreadRowStatus, signal }) {
      // Older bb clients lack the setter: the header badge still works.
      setRowStatusSetter(experimental_setThreadRowStatus ?? null);
      const release = (): void => setRowStatusSetter(null);
      signal.addEventListener("abort", release, { once: true });
      return release;
    },
  });
  app.slots.experimental_appOverlay({ id: "stops-sync", component: StopsSync });
  app.slots.experimental_threadHeaderAction({ id: "stop-reason", title: "Why this thread stopped", component: StopBadge });
});
