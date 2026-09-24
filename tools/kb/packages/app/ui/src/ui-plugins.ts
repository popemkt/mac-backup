/**
 * The plugins the UI ships with. The shell starts them before it renders;
 * each owns its pages and sidebar section, and nothing in the shell names any
 * of them again.
 *
 * Two lists, one mechanism: every plugin reaches the kernel through
 * `syncUiPlugins`, and the only difference an optional plugin has is that the
 * `enabledPlugins` preference decides whether it is in the set.
 */
import type { Plugin } from "@kb/plugin";
import { canvasUiPlugin } from "@/components/canvas/plugin";
import { graphUiPlugin } from "@/components/graph/plugin";
import { ontologyUiPlugin } from "@/components/ontology/plugin";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { syncUiPlugins, type OptionalUiPlugin } from "@/lib/plugins";
import { usePrefsStore } from "@/stores/prefs.store";

/** Always loaded. */
export const BUILTIN_UI_PLUGINS: readonly Plugin[] = [
  outlineUiPlugin,
  graphUiPlugin,
  ontologyUiPlugin,
  canvasUiPlugin,
];

/** Loaded only while switched on in Preferences; off by default. */
export const OPTIONAL_UI_PLUGINS: readonly OptionalUiPlugin[] = [];

/** The plugins the kernel should hold for this set of enabled names. */
export function uiPluginsFor(
  optional: readonly OptionalUiPlugin[],
  enabled: readonly string[],
): readonly Plugin[] {
  const on = new Set(enabled);
  return [
    ...BUILTIN_UI_PLUGINS,
    ...optional.filter((entry) => on.has(entry.plugin.name)).map((entry) => entry.plugin),
  ];
}

/**
 * Load the UI's plugins, then keep the kernel in step with the preference:
 * switching an optional plugin off unloads it, and its pages and sidebar
 * section leave with it, without a reload. Returns the unsubscribe.
 */
export function startUiPlugins(): () => void {
  const sync = (enabled: readonly string[]) =>
    syncUiPlugins(uiPluginsFor(OPTIONAL_UI_PLUGINS, enabled));
  sync(usePrefsStore.getState().enabledPlugins);
  return usePrefsStore.subscribe((next, previous) => {
    if (next.enabledPlugins !== previous.enabledPlugins) sync(next.enabledPlugins);
  });
}
