/**
 * The plugins the UI ships with. The shell starts them before it renders;
 * each owns its pages and sidebar section, and nothing in the shell names any
 * of them again.
 *
 * Two lists, one mechanism: every plugin reaches the kernel through
 * `syncUiPlugins`, and the only difference an optional plugin has is that the
 * `enabledPlugins` preference decides whether it is in the set.
 *
 * These lists name extensions on their own, apart from the server's registry:
 * GAP [[01M41H30N0SV4QE5R8VQQ1K4ZA]]. The feature plugins are zones of this
 * package, and the optional ones load statically: GAP [[01M41H30C2RSD2FGVYBT5HAG48]]
 */
import { ChatCircleDotsIcon, FlaskIcon } from "@phosphor-icons/react";
import type { Plugin } from "@kb/plugin";
import { agentPlugin } from "@/agent";
import { canvasUiPlugin } from "@/components/canvas/plugin";
import { chartUiPlugin } from "@/components/chart/plugin";
import { codeUiPlugin } from "@/components/code/plugin";
import { graphUiPlugin } from "@/components/graph/plugin";
import { labUiPlugin } from "@/components/lab/plugin";
import { layoutUiPlugin } from "@/components/layout/plugin";
import { ontologyUiPlugin } from "@/components/ontology/plugin";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { syncUiPlugins, type OptionalUiPlugin } from "@/lib/plugins";
import { screenUiPlugin } from "@/screen";
import { usePrefsStore } from "@/stores/prefs.store";
import { webMcpUiPlugin } from "@/webmcp";

/** Always loaded. */
export const BUILTIN_UI_PLUGINS: readonly Plugin[] = [
  outlineUiPlugin,
  graphUiPlugin,
  ontologyUiPlugin,
  canvasUiPlugin,
  layoutUiPlugin,
  chartUiPlugin,
  codeUiPlugin,
  webMcpUiPlugin,
  screenUiPlugin,
];

/** Loaded only while switched on in Preferences; off by default. */
export const OPTIONAL_UI_PLUGINS: readonly OptionalUiPlugin[] = [
  { plugin: labUiPlugin, label: "lab", icon: FlaskIcon },
  { plugin: agentPlugin, label: "agent", icon: ChatCircleDotsIcon },
];

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
