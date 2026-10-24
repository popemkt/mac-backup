// lively's frontend: the motion layer as a content script, a headless app
// overlay that feeds it settings and the sidebar's status changes, an
// invisible composer action that reports sends, and a settings section that
// lists bb selectors that have stopped matching.
import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useComposer,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { CLASSES } from "@popemkt/bb-lively-core";
import { mountLively, selectorHealth, sent, syncSettings, threadsChanged } from "./adapter/bb.ts";
import { settingsInput } from "./adapter/settings.ts";

function SettingsSync() {
  const { values } = useSettings();
  useEffect(() => {
    syncSettings(settingsInput(values ?? {}));
  }, [values]);
  return null;
}

/** Pulses a sidebar row when its thread finishes, fails, or starts waiting (experimental hook: feature-detected). */
function StatusWatch() {
  const { threads, status } = experimental_useSidebarThreads();
  const previous = useRef<ReadonlyMap<string, (typeof threads)[number]["indicator"]>>(new Map());
  useEffect(() => {
    if (status !== "ready") return;
    previous.current = threadsChanged(previous.current, threads);
  }, [threads, status]);
  return null;
}

/** Renders nothing in each composer: reports sends, and applies the accent caret when that effect is on. */
function SendSignal() {
  const composer = useComposer();
  const { values } = useSettings();
  const caret = values?.["typingGlow"] === true;
  useEffect(() => composer.onSubmitted(sent), [composer]);
  useEffect(() => {
    composer.setTextEffect(caret ? { className: CLASSES.typing } : null);
  }, [composer, caret]);
  return null;
}

/** The selector canary: every bb selector that has matched nothing since this window loaded. */
function SelectorHealth() {
  const [readings, setReadings] = useState(selectorHealth);
  useEffect(() => {
    const timer = setInterval(() => setReadings(selectorHealth()), 2000);
    return () => clearInterval(timer);
  }, []);
  if (readings === undefined) return <p className="text-sm text-muted-foreground">The motion layer is not running in this window.</p>;
  const missing = readings.filter((reading) => !reading.seen);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        {missing.length === 0
          ? `All ${readings.length} bb selectors have matched in this window.`
          : `${readings.length - missing.length} of ${readings.length} bb selectors have matched in this window. These have not yet; most only show on a certain screen, so open it before calling one broken:`}
      </p>
      {missing.length > 0 && (
        <ul className="space-y-1">
          {missing.map(({ entry }) => (
            <li key={entry.id} className="rounded-md border border-border px-2 py-1">
              <div className="font-mono text-xs">{entry.id}</div>
              <div className="text-muted-foreground">
                {entry.purpose}. Shows in: {entry.where}. Verified on bb {entry.verified}.
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "motion",
    mount: ({ signal }) => {
      mountLively(signal);
    },
  });
  app.slots.experimental_appOverlay({ id: "settings-sync", component: SettingsSync });
  // An experimental hook: older or newer clients may not have it; then rows simply never pulse.
  if (typeof experimental_useSidebarThreads === "function") {
    app.slots.experimental_appOverlay({ id: "status-watch", component: StatusWatch });
  }
  app.composer.customize({ id: "send-signal", actions: [{ id: "send-signal", component: SendSignal }] });
  app.slots.settingsSection({
    id: "selector-health",
    title: "Selector health",
    description: "lively reaches into bb's own markup; a bb update can rename what it relies on.",
    component: SelectorHealth,
  });
});
