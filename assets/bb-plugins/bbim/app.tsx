// bbim's frontend: the core engine mounted as a content script, bb commands
// for the chords, and a headless overlay that feeds it settings and bb's URL
// opener (content scripts have no hooks).
import { useEffect } from "react";
import { definePluginApp, useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { commandAvailable, mountBbim, runAction, syncOpenUrl, syncSettings } from "./adapter/bb.ts";
import { settingsInput } from "./adapter/settings.ts";

function SettingsSync() {
  const { values } = useSettings();
  const navigate = useBbNavigate();
  useEffect(() => {
    syncSettings(settingsInput(values ?? {}));
  }, [values]);
  useEffect(() => {
    syncOpenUrl((url) => navigate.openUrl(url));
  }, [navigate]);
  return null;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "keyboard",
    mount: ({ signal }) => {
      mountBbim(signal);
    },
  });
  app.commands.register({
    id: "hints",
    title: "bbim: show hints (click, follow or focus)",
    defaultShortcut: { key: "f", alt: true },
    isAvailable: commandAvailable,
    run: () => runAction("hints"),
  });
  app.commands.register({
    id: "hints-new-tab",
    title: "bbim: show hints, open links in a new tab",
    defaultShortcut: { key: "f", alt: true, shift: true },
    isAvailable: commandAvailable,
    run: () => runAction("hintsNewTab"),
  });
  app.commands.register({
    id: "help",
    title: "bbim: show keyboard help",
    isAvailable: commandAvailable,
    run: () => runAction("help"),
  });
  app.slots.experimental_appOverlay({ id: "settings-sync", component: SettingsSync });
});
