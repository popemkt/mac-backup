// lively's frontend: the motion layer as a content script, a headless app
// overlay that feeds it settings and the sidebar's status changes, an
// invisible composer action that reports sends, and two settings sections:
// the active preset with every effective value, and the bb selectors that
// have stopped matching.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useComposer,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { CLASSES } from "@popemkt/bb-lively-core";
import { mountLively, selectorHealth, sent, syncSettings, threadsChanged } from "./adapter/bb.ts";
import { themeIdOf } from "./adapter/palette.ts";
import { effectiveRows, effectiveSettings, PLUGIN_ID, settingsInput } from "./adapter/settings.ts";

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
  const caret = effectiveSettings(values ?? {}).settings.effects.typingGlow;
  useEffect(() => composer.onSubmitted(sent), [composer]);
  useEffect(() => {
    composer.setTextEffect(caret ? { className: CLASSES.typing } : null);
  }, [composer, caret]);
  return null;
}

/** The palette's bb theme: its name, and a one-click switch when bb shows another theme. */
function PaletteLine({ palette }: { readonly palette: string | null }) {
  const sdk = useSdk();
  const [active, setActive] = useState<string | undefined>();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const target = palette === null ? undefined : themeIdOf(PLUGIN_ID, palette);
  useEffect(() => {
    let live = true;
    void sdk.theme
      .catalog()
      .then((catalog) => {
        if (live) {
          setActive(catalog.active.themeId);
          setNames(new Map(catalog.plugins.map((theme) => [theme.id.startsWith("plugin:") ? theme.id : themeIdOf(theme.pluginId, theme.id), theme.name])));
        }
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sdk, target]);
  if (target === undefined) return <p className="text-muted-foreground">Palette: bb's own theme (Settings → Appearance).</p>;
  const name = names.get(target) ?? palette;
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span>
        Palette: <strong>{name}</strong>
        {active === target ? " (active)" : ", switched to when you pick the preset."}
      </span>
      {active !== undefined && active !== target && (
        <button
          type="button"
          className="rounded-md border border-border px-2 py-0.5 text-xs"
          onClick={() => void sdk.theme.set(target).then((theme) => setActive(theme.themeId))}
        >
          Use {name} now
        </button>
      )}
    </p>
  );
}

/** The active preset, its palette, the art image, and every setting's effective value with where it came from. */
function PresetSection() {
  const { values } = useSettings();
  const resolved = useMemo(() => effectiveSettings(values ?? {}), [values]);
  const rows = useMemo(() => effectiveRows(resolved), [resolved]);
  const image = typeof values?.["artImage"] === "string" ? values["artImage"] : "";
  return (
    <div className="space-y-2 text-sm">
      <p>
        <strong>{resolved.preset.label}</strong>: <span className="text-muted-foreground">{resolved.preset.description}</span>
      </p>
      <PaletteLine palette={resolved.settings.palette} />
      <p className="text-muted-foreground">
        {image === ""
          ? "Art image: none; the preset's own art shows alone. Set Art image to a URL or a file on the bb machine."
          : `Art image: ${image}${resolved.settings.art ? "" : " (hidden: Art is off)"}.`}
      </p>
      <table className="w-full text-left">
        <thead className="text-muted-foreground">
          <tr>
            <th className="font-normal">Setting</th>
            <th className="font-normal">Currently</th>
            <th className="font-normal">From</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{row.value}</td>
              <td className="text-muted-foreground">{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
    id: "preset",
    title: "Preset",
    description: "What each setting is now, and whether you set it, the preset did, or it is the default.",
    component: PresetSection,
  });
  app.slots.settingsSection({
    id: "selector-health",
    title: "Selector health",
    description: "lively reaches into bb's own markup; a bb update can rename what it relies on.",
    component: SelectorHealth,
  });
});
