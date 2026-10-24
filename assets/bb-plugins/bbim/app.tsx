// bbim's frontend: the core engine mounted as a content script, bb commands
// for the chords, and a headless overlay that feeds it settings and bb's URL
// opener (content scripts have no hooks).
import { useEffect, useRef } from "react";
import {
  definePluginApp,
  type ExperimentalPluginBrowserToolbarActionProps,
  useBbNavigate,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { attachBrowserPage, commandAvailable, mountBbim, runAction, syncOpenUrl, syncSettings } from "./adapter/bb.ts";
import { hostSettings, settingsInput } from "./adapter/settings.ts";

function SettingsSync() {
  const { values } = useSettings();
  const navigate = useBbNavigate();
  useEffect(() => {
    syncSettings(settingsInput(values ?? {}), hostSettings(values ?? {}));
  }, [values]);
  useEffect(() => {
    syncOpenUrl((url) => navigate.openUrl(url));
  }, [navigate]);
  return null;
}

/**
 * Renders nothing beside a Browser tab's address bar; it is how bbim gets
 * the tab's page (`experimental_page`, desktop only: null elsewhere, and
 * then the tab simply gets no hints). Re-attached when the URL changes, so
 * chords work at once in the new page; a reload to the same URL keeps the
 * URL, and the engine's keep-alive puts the page bridge back within seconds.
 */
function BrowserPageHints({ url, experimental_page: page }: ExperimentalPluginBrowserToolbarActionProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = anchor.current;
    if (element === null) return undefined;
    return attachBrowserPage(element, page);
  }, [page, url]);
  return <span ref={anchor} hidden />;
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
    id: "pick-scroll",
    title: "bbim: pick the pane j/k scroll",
    defaultShortcut: { key: "s", alt: true },
    isAvailable: commandAvailable,
    run: () => runAction("pickScroll"),
  });
  app.commands.register({
    id: "help",
    title: "bbim: show keyboard help",
    isAvailable: commandAvailable,
    run: () => runAction("help"),
  });
  app.slots.experimental_appOverlay({ id: "settings-sync", component: SettingsSync });
  app.slots.experimental_browserToolbarAction({ id: "page-hints", title: "bbim hints", component: BrowserPageHints });
});
