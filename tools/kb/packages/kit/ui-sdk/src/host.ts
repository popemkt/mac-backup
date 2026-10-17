/**
 * `BrowserHost`: what a feature's UI reaches of the shell (DESIGN-UI.md →
 * Extension UI halves). The shell provides it to the UI kernel
 * (`src/browser-host.ts`), and a feature plugin injects it, so the plugin
 * waits as pending until the shell has provided it. This module names the
 * shape and never imports a store.
 *
 * It holds no React hooks. It is a source to subscribe to, reads of what
 * that source holds now, and gestures. A hook that crosses a plugin boundary
 * would be selected at run time, which React cannot check. So the sdk's own
 * hooks (`sdk/hooks.ts`) are built over these reads, once, with
 * `useSyncExternalStore`.
 */
import { Service } from "@kb/plugin";
import type { ActionInvocation, ActionReceipt, WireNode } from "@kb/contracts";
import type { CommandTarget, NodeCommandListing, PaletteSurface } from "./lib/command-point";
import type { ViewKey } from "@kb/views";
import type { NodeTextPort } from "./components/node-text-port";
import type { RefInk } from "./lib/md-edit";
import type { PageGraphPort } from "./lib/page-graph";
import type { PageWrites } from "./lib/page-writes";
import type { PaneScreenPort } from "./lib/pane-screen";
import { currentService } from "./lib/plugins";
import type { Appearance, Prefs } from "./lib/theme";
import type { OutlineNode } from "./lib/types";
import type { QueryRowsSubscribe } from "./lib/use-query-node-rows";
import type { HostedFrame, SandboxEvents, SandboxPorts, SandboxRun } from "./sandbox";

/** A view node to make from settings: what `view.propose` checks. */
export interface ViewProposal {
  readonly view: ViewKey<unknown>;
  readonly params: Readonly<Record<string, unknown>>;
  /** The node it is shown for, which names it among its views. */
  readonly host?: string;
  readonly text?: string;
}

/** The new view node's id, or the receipt's message when the proposal was refused. */
export type ProposedView = { readonly id: string } | { readonly refused: string };

/**
 * The page's host. It is a node text port too (`NodeTextPort`): the graph
 * reads, the caret hand-off, the text-host registry and the gestures a node
 * text host makes, so a half binds a text host through it
 * (`useNodeTextBinding`) as the shell binds its own through its stores.
 */
export interface BrowserHost extends NodeTextPort {
  /** A node of the graph, as the page shows it: a row of the projection it stands in. */
  readonly node: (id: string) => OutlineNode | undefined;
  /** Whether a node is being edited in this instance (`instanceKey`). */
  readonly isActive: (nodeId: string, instanceKey: string) => boolean;
  /** Whether any node's text is being edited, in any instance. */
  readonly editing: () => boolean;
  /** Whether a node is selected in this instance (`instanceKey`). */
  readonly isSelected: (nodeId: string, instanceKey: string) => boolean;
  /** Open or close a row: the page's editor's expansion (`PageEditorState.toggleCollapse`). */
  readonly toggleCollapse: (nodeId: string) => void;
  /** The graph's nodes as they came over the wire. */
  readonly wireNodes: () => WireNode[];
  /** Whether the live socket is open, so a query subscribes instead of running locally. */
  readonly live: () => boolean;
  /** Subscribe a query node's rows over the live socket, as one subscriber; returns the unsubscribe. */
  readonly subscribeQuery: QueryRowsSubscribe;
  readonly appearance: () => Appearance;
  /** The device-level preferences now. */
  readonly prefs: () => Prefs;
  readonly prefsOpen: () => boolean;
  readonly setPrefsOpen: (open: boolean) => void;
  /** Whether the left rail is open, at a narrow or a wide viewport. */
  readonly sidebarOpen: (narrow: boolean) => boolean;
  /** Toggle the left rail from its button, drawn with the rail `open`; focus returns to it. */
  readonly toggleSidebar: (
    narrow: boolean,
    open: boolean,
    button: HTMLButtonElement | null,
  ) => void;
  /** How references in rendered text are inked. */
  readonly refInk: () => RefInk;
  /** Zoom the outline to a node. */
  readonly zoomTo: (id: string) => void;
  /** Zoom home: to the workspace, or to the ontology while scoped. */
  readonly zoomHome: () => void;
  /** The page's graph: the state a projection reads, and the moves it makes in it. */
  readonly graph: PageGraphPort;
  /** Which nodes show their debug fields (`sys.*` and hidden props), and the switch for one. */
  readonly debugFields: {
    readonly ids: () => ReadonlySet<string>;
    readonly toggle: (nodeId: string) => void;
  };
  /** The frame whose filter popover is open, if any, and how to open one or close it. */
  readonly filterFrame: () => string | null;
  readonly setFilterFrame: (frameId: string | null) => void;
  /** Whether the node palette is open (`setNodePaletteOpen` opens and closes it). */
  readonly nodePaletteOpen: () => boolean;
  /**
   * The node menu for `target`: the registry's node commands it offers, in
   * order, each run against the page's state as it is when it runs.
   */
  readonly nodeCommands: (
    target: CommandTarget,
    palette: PaletteSurface,
  ) => readonly NodeCommandListing[];
  /** Start editing a node's text in one instance, with the caret at `cursorPos`. */
  readonly activateNode: (nodeId: string, cursorPos?: number, instanceKey?: string) => void;
  /** Send a pane to a path. */
  readonly navigatePane: (pane: string, path: string) => void;
  /** The page's one write path: every write a surface makes to the graph. */
  readonly writes: PageWrites;
  /** Make one call through the browser's one invoke path and answer its receipt. */
  readonly invoke: (id: string, input: unknown) => Promise<ActionReceipt>;
  /** Where a view reports what it shows for its pane (`usePaneScreen`). */
  readonly screen: PaneScreenPort;
  /** Make a view node through `view.propose`, the one check of a proposed view. */
  readonly proposeView: (proposal: ViewProposal) => Promise<ProposedView>;
  /** The page's end of the sandbox bridge (DESIGN.md → Sandbox). */
  readonly sandbox: {
    /** Host `run` in `frame`, an iframe sandboxed with `allow-scripts` alone. */
    readonly hostFrame: (
      frame: HTMLIFrameElement,
      run: SandboxRun,
      ports: SandboxPorts,
      events: SandboxEvents,
    ) => HostedFrame;
    /** Make one call as the script's, answered with what the server made of it. */
    readonly invokeAsScript: (invocation: ActionInvocation) => Promise<ActionReceipt>;
    /** Whether a person has trusted the code with `digest` on this machine. */
    readonly isTrusted: (digest: string) => Promise<boolean>;
    /** Trust, or stop trusting, the code with `digest`: the person's own gesture. */
    readonly setTrusted: (digest: string, trusted: boolean) => Promise<ActionReceipt>;
  };
}

export const BrowserHostService = Service<BrowserHost>()("ui.host");

/** The page's host. Only a plugin that injects `BrowserHostService` may rely on it. */
export function browserHost(): BrowserHost {
  const host = currentService(BrowserHostService);
  if (host === undefined) throw new Error("no BrowserHost: the shell's host plugin is not loaded");
  return host;
}
