/**
 * The plugins the UI ships with, and which of them the page loads. The shell
 * starts them before it renders; each owns its pages and sidebar section, and
 * nothing in the shell names any of them again.
 *
 * The page holds a resolver, not a second list (DESIGN-UI.md → Extension UI
 * halves): the core plugins are always loaded, and a family's browser entry
 * is loaded when the server reports that family loaded, in `kb.manifest`.
 * Until a server answers, the page is its own server, reading the one bundled
 * list. Every plugin reaches the kernel through `syncUiPlugins`.
 *
 * The lab is still switched in the browser's preference, and the agent's UI
 * follows the preference alone, not the server that hosts it:
 * GAP [[01M41H30N0SV4QE5R8VQQ1K4ZA]]. The feature plugins are zones of this
 * package: GAP [[01M41H30C2RSD2FGVYBT5HAG48]]
 */
import { useSyncExternalStore } from "react";
import { ChatCircleDotsIcon, PuzzlePieceIcon } from "@phosphor-icons/react";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { canvasExtension } from "@kb/canvas";
import { chartExtension } from "@kb/chart";
import { codeExtension } from "@kb/code";
import { declarationPlugin, extensionRow, type ExtensionRow } from "@kb/contracts";
import { labExtension } from "@kb/lab";
import { coreExtension } from "@kb/operations";
import type { Plugin } from "@kb/plugin";
import { agentPlugin } from "@/agent";
import { browserHostUiPlugin } from "@/browser-host";
import { canvasUiPlugin } from "@/components/canvas/plugin";
import { chartUiPlugin } from "@/components/chart/plugin";
import { codeUiPlugin } from "@/components/code/plugin";
import { graphUiPlugin } from "@/components/graph/plugin";
import { layoutUiPlugin } from "@/components/layout/plugin";
import { ontologyUiPlugin } from "@/components/ontology/plugin";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { logWarn } from "@/lib/log";
import { servedManifest, subscribeManifest } from "@/lib/manifest";
import { syncUiPlugins, type ExtensionSwitch } from "@/lib/plugins";
import { screenUiPlugin } from "@/screen";
import { usePrefsStore } from "@/stores/prefs.store";
import { webMcpUiPlugin } from "@/webmcp";

/**
 * Always loaded: the shell's own projections. Core's views reach the page
 * kernel's catalog through the same declaration the server loads them from.
 */
export const CORE_UI_PLUGINS: readonly Plugin[] = [
  declarationPlugin(coreExtension),
  browserHostUiPlugin,
  outlineUiPlugin,
  graphUiPlugin,
  ontologyUiPlugin,
  layoutUiPlugin,
  webMcpUiPlugin,
  screenUiPlugin,
];

/** How the page loads a family's browser entry. */
export interface BrowserExtension {
  readonly load: () => Promise<Plugin>;
}

/**
 * The browser entry of each family the page can draw, keyed by the name its
 * declaration gives it. A family that is always on loads from the main
 * bundle; an optional one is its own chunk, fetched when it is first on.
 */
export const BROWSER_EXTENSIONS: Readonly<Record<string, BrowserExtension>> = {
  [canvasExtension.name]: { load: () => Promise.resolve(canvasUiPlugin) },
  [labExtension.name]: {
    load: () => import("@/components/lab/plugin").then(({ labUiPlugin }) => labUiPlugin),
  },
  [codeExtension.name]: { load: () => Promise.resolve(codeUiPlugin) },
  [chartExtension.name]: { load: () => Promise.resolve(chartUiPlugin) },
};

/** The bundled families as the page reads them while no server answers: every one loaded. */
const OWN_EXTENSIONS: readonly ExtensionRow[] = BUNDLED_FAMILIES.map((declaration) =>
  extensionRow(declaration, "bundled", true),
);

/** The extensions the page follows: the server's report, else its own reading. */
function followedExtensions(): readonly ExtensionRow[] {
  return servedManifest()?.extensions ?? OWN_EXTENSIONS;
}

/**
 * The families whose browser entry the page loads, in the order reported:
 * each one reported loaded that the resolver has, less an optional one the
 * preference has off.
 */
export function familiesToLoad(
  rows: readonly ExtensionRow[],
  enabled: readonly string[],
  resolver: Readonly<Record<string, BrowserExtension>> = BROWSER_EXTENSIONS,
): readonly string[] {
  return rows
    .filter((row) => row.enabled && Object.hasOwn(resolver, row.name))
    .filter((row) => !row.optional || enabled.includes(row.name))
    .map((row) => row.name);
}

/** The agent's UI, switched in the preference. */
const AGENT_SWITCH: ExtensionSwitch = {
  name: agentPlugin.name,
  label: "agent",
  icon: ChatCircleDotsIcon,
};

/** The switches for these rows: each optional family the resolver has, then the agent's. */
function switchesFor(rows: readonly ExtensionRow[]): readonly ExtensionSwitch[] {
  return [
    ...rows
      .filter((row) => row.optional && Object.hasOwn(BROWSER_EXTENSIONS, row.name))
      .map((row) => ({ name: row.name, label: row.label, icon: PuzzlePieceIcon })),
    AGENT_SWITCH,
  ];
}

let switchesMemo: {
  rows: readonly ExtensionRow[];
  switches: readonly ExtensionSwitch[];
} | null = null;

function currentSwitches(): readonly ExtensionSwitch[] {
  const rows = followedExtensions();
  if (switchesMemo?.rows !== rows) switchesMemo = { rows, switches: switchesFor(rows) };
  return switchesMemo.switches;
}

/** The switches Preferences offers now, re-read when the server's report moves. */
export function useExtensionSwitches(): readonly ExtensionSwitch[] {
  return useSyncExternalStore(subscribeManifest, currentSwitches, currentSwitches);
}

/** Load one family's browser entry, held to the name it was resolved by. */
async function loadEntry(name: string): Promise<Plugin | null> {
  const extension = BROWSER_EXTENSIONS[name];
  if (extension === undefined) return null;
  try {
    const plugin = await extension.load();
    if (plugin.name === name) return plugin;
    logWarn(`[kb/plugins] the browser entry for ${name} is named ${plugin.name}; it is left out`);
  } catch (error) {
    logWarn(`[kb/plugins] the browser entry for ${name} failed to load: ${String(error)}`);
  }
  return null;
}

let generation = 0;

/**
 * Converge the kernel on the core plugins plus the entries for `rows`. The
 * entries load first, so the kernel moves once; a newer convergence that
 * starts meanwhile wins, and this one is dropped.
 */
async function converge(rows: readonly ExtensionRow[], enabled: readonly string[]): Promise<void> {
  const mine = ++generation;
  const entries = await Promise.all(familiesToLoad(rows, enabled).map(loadEntry));
  if (mine !== generation) return;
  syncUiPlugins([
    ...CORE_UI_PLUGINS,
    ...entries.filter((entry) => entry !== null),
    ...(enabled.includes(agentPlugin.name) ? [agentPlugin] : []),
  ]);
}

/**
 * Load the UI's plugins, then keep the kernel in step with the server's
 * report and the preference: a family the report or the preference drops is
 * unloaded, and its pages and sidebar section leave with it, without a
 * reload. Returns the unsubscribe.
 */
export function startUiPlugins(): () => void {
  const sync = () => void converge(followedExtensions(), usePrefsStore.getState().enabledPlugins);
  sync();
  const unsubscribeManifest = subscribeManifest(sync);
  const unsubscribePrefs = usePrefsStore.subscribe((next, previous) => {
    if (next.enabledPlugins !== previous.enabledPlugins) sync();
  });
  return () => {
    unsubscribeManifest();
    unsubscribePrefs();
  };
}
