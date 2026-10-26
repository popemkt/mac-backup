// lively's backend: it declares the settings (adapter/settings.ts), switches
// bb's theme when a settings write changes the preset's palette
// (adapter/palette.ts), and serves the person's art image when it is a file
// on this machine (adapter/art.ts). The motion and the art run in the
// frontend (app.tsx); the palettes are manifest entries.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { artResponse } from "./adapter/art.ts";
import { paletteStep, SAVED_THEME_KEY } from "./adapter/palette.ts";
import { ART_ROUTE, effectiveSettings, SETTINGS } from "./adapter/settings.ts";

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define(SETTINGS);

  settings.onChange((next, prev) => {
    const before = effectiveSettings(prev).settings.palette;
    const after = effectiveSettings(next).settings.palette;
    if (before === after) return;
    void (async () => {
      const active = (await bb.sdk.theme.get()).themeId;
      const saved = await bb.storage.kv.get<string>(SAVED_THEME_KEY);
      const step = paletteStep({ pluginId: bb.pluginId, before, after, active, saved });
      if (step.saved === null) await bb.storage.kv.delete(SAVED_THEME_KEY);
      else if (step.saved !== undefined) await bb.storage.kv.set(SAVED_THEME_KEY, step.saved);
      if (step.set !== undefined) await bb.sdk.theme.set(step.set);
    })().catch((error: unknown) => bb.log.warn(`could not switch the palette: ${String(error)}`));
  });

  // "local": only bb's own window (its origin) loads it.
  bb.http.route("GET", ART_ROUTE, async () => artResponse((await settings.get()).artImage));
}
