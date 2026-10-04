/**
 * The plugins the UI ships with, and which of them the page loads. The shell
 * starts them before it renders; each owns its pages and sidebar section, and
 * nothing in the shell names any of them again.
 *
 * The page holds a resolver, not a second list (DESIGN-UI.md → Extension UI
 * halves): the core plugins are always loaded, and a family's browser entry
 * is loaded exactly when the server reports that family loaded, in
 * `kb.manifest`. Whether an optional family is on is the server's decision,
 * so the page's switch for it asks the server (`extension.switch`) and then
 * follows the report. Until a server answers, the page is its own server: it
 * reads the one bundled list as a store with no switch written. Every plugin
 * reaches the kernel through `syncUiPlugins`.
 *
 * Each family's browser entry comes from its `-ui` package.
 */
import { useSyncExternalStore } from "react";
import { ulid } from "ulid";
import { AGENT_CHANNEL, agentExtension } from "@kb/agent";
import type { AgentPorts } from "@kb/agent-ui";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { canvasExtension } from "@kb/canvas";
import { chartExtension } from "@kb/chart";
import { checkExtension } from "@kb/check";
import { codeExtension } from "@kb/code";
import {
  NO_SWITCHES,
  declarationPlugin,
  extensionNodeId,
  extensionRow,
  familyOn,
  type ExtensionRow,
} from "@kb/contracts";
import { docsExtension } from "@kb/docs";
import { labExtension } from "@kb/lab";
import { coreExtension, extensionSwitchDef } from "@kb/operations";
import type { Plugin } from "@kb/plugin";
import { getLiveClient } from "@/api/live";
import { browserHostUiPlugin } from "@/browser-host";
import { canvasUiPlugin } from "@kb/canvas-ui";
import { chartUiPlugin } from "@kb/chart-ui";
import { codeUiPlugin } from "@kb/code-ui";
import { graphUiPlugin } from "@/components/graph/plugin";
import { layoutUiPlugin } from "@/components/layout/plugin";
import { ontologyUiPlugin } from "@/components/ontology/plugin";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { logWarn, syncUiPlugins, toast, type ExtensionSwitch } from "@kb/ui-sdk";
import { loadManifest, servedManifest, subscribeManifest } from "@/lib/manifest";
import { screenUiPlugin } from "@/screen";
import { invoke, invokeSettled } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
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

/**
 * The agent's ports, bound to this page: the live socket's `agent.chat`
 * channel, the socket's state, and the browser's one invoke path, through
 * which the person's approve or decline is made. The agent's UI half reaches
 * neither the socket nor the invoke path itself.
 */
const AGENT_PORTS: AgentPorts = {
  listen: (sink) => getLiveClient().listen(AGENT_CHANNEL, sink),
  send: (request) => getLiveClient().sendChannel(AGENT_CHANNEL, request),
  connection: (listener) =>
    useUiStore.subscribe((next, previous) => {
      if (next.wsStatus === previous.wsStatus) return;
      if (next.wsStatus === "open") listener(true);
      else if (previous.wsStatus === "open") listener(false);
    }),
  // A local write answers at once and is pushed after; the agent is told
  // what the server made of the call, never the optimistic first answer.
  invoke: async (invocation) => (await invokeSettled(invocation)).settled,
  newConversation: () => ulid(),
};

/** The agent's browser entry, bound to the page's ports once, the first time it loads. */
let agentEntry: Plugin | undefined;
async function loadAgentEntry(): Promise<Plugin> {
  const { agentUiPlugin } = await import("@kb/agent-ui");
  agentEntry ??= agentUiPlugin(AGENT_PORTS);
  return agentEntry;
}

/** How the page loads a family's browser entry. */
export interface BrowserExtension {
  readonly load: () => Promise<Plugin>;
}

/**
 * The browser entry of each family, keyed by the name its declaration gives
 * it. Whether the page loads one is the server's report, never this table.
 * How it is fetched is: a family a store has on by default (canvas, code,
 * chart) loads from the main bundle, and one off by default (the lab) or
 * hosted only by `kb ui` (the agent) is its own chunk, fetched when it is
 * first on. A family with no browser half is listed too, as `null`, so a
 * bundled family is never left out by omission: the resolver's test holds
 * every bundled family to an entry.
 */
export const BROWSER_EXTENSIONS: Readonly<Record<string, BrowserExtension | null>> = {
  [docsExtension.name]: null,
  [canvasExtension.name]: { load: () => Promise.resolve(canvasUiPlugin) },
  [labExtension.name]: {
    load: () => import("@kb/lab-ui").then(({ labUiPlugin }) => labUiPlugin),
  },
  [checkExtension.name]: null,
  [codeExtension.name]: { load: () => Promise.resolve(codeUiPlugin) },
  [chartExtension.name]: { load: () => Promise.resolve(chartUiPlugin) },
  [agentExtension.name]: { load: loadAgentEntry },
};

/**
 * The bundled families as the page reads them while no server answers: a
 * server over a store with no switch written, so an optional family is as
 * its declaration has it by default.
 * It hosts nothing, so it reports no agent.
 */
const OWN_EXTENSIONS: readonly ExtensionRow[] = BUNDLED_FAMILIES.map((declaration) =>
  extensionRow(declaration, "bundled", familyOn(declaration, NO_SWITCHES, logWarn)),
);

/** The extensions the page follows: the server's report, else its own reading. */
function followedExtensions(): readonly ExtensionRow[] {
  return servedManifest()?.extensions ?? OWN_EXTENSIONS;
}

/**
 * The families whose browser entry the page loads, in the order reported:
 * each one reported loaded that the resolver has. A family the server did
 * not load, or does not report, has no UI on the page.
 */
export function familiesToLoad(rows: readonly ExtensionRow[]): readonly string[] {
  return rows
    .filter((row) => row.enabled && browserEntry(row.name) !== null)
    .map((row) => row.name);
}

/** The browser entry the page has for a family: null when it has none, or the family has no browser half. */
function browserEntry(name: string): BrowserExtension | null {
  return Object.hasOwn(BROWSER_EXTENSIONS, name) ? (BROWSER_EXTENSIONS[name] ?? null) : null;
}

/**
 * The switches for these rows: each optional family the server reports, on
 * as it reports it. Whether the family has a browser half does not matter:
 * the switch is the server's, and Preferences is where a person reaches it.
 */
function switchesFor(rows: readonly ExtensionRow[]): readonly ExtensionSwitch[] {
  return rows
    .filter((row) => row.optional)
    .map(({ name, label, enabled }) => ({ name, label, on: enabled }));
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

/**
 * Switch an optional family on the server, then read its report again, which
 * the page follows. A refusal is shown, and the page stays as the server has
 * it.
 */
export async function switchExtension(name: string, on: boolean): Promise<void> {
  const receipt = await invoke(extensionSwitchDef.id, { name, on });
  if (receipt.status === "failed") toast(receipt.message);
  await loadManifest();
}

/** Load one family's browser entry, held to the name it was resolved by. */
async function loadEntry(name: string): Promise<Plugin | null> {
  const extension = browserEntry(name);
  if (extension === null) return null;
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
/** The latest convergence, done once the kernel holds what it was started for. */
let settling: Promise<void> = Promise.resolve();

/**
 * Converge the kernel on the core plugins plus the entries for `rows`. The
 * entries load first, so the kernel moves once; a newer convergence that
 * starts meanwhile wins, and this one is dropped.
 */
async function converge(rows: readonly ExtensionRow[]): Promise<void> {
  const mine = ++generation;
  const entries = await Promise.all(familiesToLoad(rows).map(loadEntry));
  if (mine !== generation) return;
  syncUiPlugins([...CORE_UI_PLUGINS, ...entries.filter((entry) => entry !== null)]);
}

/**
 * Where the page's graph has the switch node of each optional family it
 * follows now: its version, joined.
 */
function switchVersions(): string {
  const { nodes } = useOutlineStore.getState();
  return followedExtensions()
    .filter((row) => row.optional)
    .map((row) => nodes.get(extensionNodeId(row.name))?.updatedAt ?? "")
    .join("\n");
}

/**
 * Done once the kernel holds the plugins for the extensions the page follows
 * now: the latest convergence, and any started while it ran.
 */
export async function extensionsSettled(): Promise<void> {
  const current = settling;
  await current;
  if (current !== settling) await extensionsSettled();
}

/**
 * Load the UI's plugins, then keep the kernel in step with the server's
 * report: a family the report drops is unloaded, and its pages and sidebar
 * section leave with it, without a reload. A switch written anywhere (another
 * tab, the CLI) reaches this page's graph, and the page reads the server's
 * report again. Returns the unsubscribe.
 */
export function startUiPlugins(): () => void {
  const sync = () => {
    settling = converge(followedExtensions());
  };
  sync();
  const unsubscribeManifest = subscribeManifest(sync);
  let switches = switchVersions();
  const unsubscribeGraph = useOutlineStore.subscribe(() => {
    const next = switchVersions();
    if (next === switches) return;
    switches = next;
    if (servedManifest() !== null) void loadManifest();
  });
  return () => {
    unsubscribeManifest();
    unsubscribeGraph();
  };
}
